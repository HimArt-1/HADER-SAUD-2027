"""جدولة إشعارات الحضور على الخادم بدل صفحة المتصفح.

كان «الطيار الآلي» يعيش داخل صفحة واتساب في حاضر: ``setInterval`` يفحص الساعة ويضيف
رسائل التأخر إلى الطابور. ذلك يعني أن الإشعارات لا تُنشأ إلا إذا صادف أن أحداً يُبقي
اللوحة مفتوحة على جهازه، وأنها تُنشأ مرتين إذا فتحها اثنان، وأن المنطقة الزمنية هي
منطقة جهاز الموظف لا منطقة المدرسة.

هذه الوحدة تنقل ذلك إلى الخادم:

* الإعدادات في قاعدة البيانات، فتصمد عبر إعادة التشغيل ولا تخص جهازاً بعينه.
* الوقت يُحسب بمنطقة المدرسة الزمنية المحفوظة، لا بمنطقة المتصفح.
* لكل تشغيل مفتاح فريد يُحجز في قاعدة البيانات، فلا يتكرر مهما أُعيد التشغيل.
* المعرّفات محسوبة من (التاريخ، النوع، الطالب)، فإن وصل الصف مرتين تجاهله الطابور.

الجدولة تضيف إلى الطابور فقط. لا تبدأ الإرسال إطلاقاً: ذلك قرار منفصل يبقى بيد
المشرف عبر ``/api/sending/start``.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Sequence

try:  # pragma: no cover - the stdlib path is what runs everywhere we deploy
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]

import sqlite_db

SETTINGS_KEY = 'attendance_schedule'
DEFAULT_TIMEZONE = 'Asia/Riyadh'

DEFAULT_TEMPLATES = {
    'late': 'مرحباً، نفيدكم بأن الطالب/ة {StudentName} حضر/ت متأخراً اليوم {Date} الساعة {Time}.',
    'absent': 'مرحباً، نفيدكم بأن الطالب/ة {StudentName} لم يحضر/تحضر اليوم {Date}. نرجو التواصل مع المدرسة.',
}

DEFAULT_SETTINGS: Dict[str, Any] = {
    'enabled': False,
    'time': '09:00',
    'timezone': DEFAULT_TIMEZONE,
    'categories': ['late', 'absent'],
    'templates': dict(DEFAULT_TEMPLATES),
    # أيام الأسبوع المدرسية بأرقام بايثون (الاثنين=0 … الأحد=6): الأحد–الخميس
    'weekdays': [6, 0, 1, 2, 3],
}

STATUS_LABELS = {'late': 'تأخر', 'absent': 'غياب'}


def _tz(name: str):
    if ZoneInfo is None:
        return None
    try:
        return ZoneInfo(name)
    except Exception:
        logging.warning(f"منطقة زمنية غير معروفة ({name}) — استُخدمت {DEFAULT_TIMEZONE}")
        try:
            return ZoneInfo(DEFAULT_TIMEZONE)
        except Exception:
            return None


def _clean_phone(raw: Any) -> str:
    digits = ''.join(ch for ch in str(raw or '').translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')) if ch.isdigit())
    return digits


class AttendanceScheduler:
    """يفحص الساعة بمنطقة المدرسة، ويضيف إشعارات اليوم مرة واحدة فقط."""

    def __init__(
        self,
        source: Optional[Callable[[str, Sequence[str]], List[Dict[str, Any]]]] = None,
        enqueue: Optional[Callable[[List[Dict[str, Any]]], Optional[int]]] = None,
        clock: Optional[Callable[[], datetime]] = None,
        tick_seconds: float = 30.0,
    ) -> None:
        self._source = source
        self._enqueue = enqueue or sqlite_db.append_to_queue
        self._clock = clock or (lambda: datetime.now())
        self._tick_seconds = tick_seconds
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.RLock()

    # ── الإعدادات ────────────────────────────────────────────

    def get_settings(self) -> Dict[str, Any]:
        stored = sqlite_db.get_setting(SETTINGS_KEY, None) or {}
        settings = dict(DEFAULT_SETTINGS)
        settings['templates'] = dict(DEFAULT_TEMPLATES)
        if isinstance(stored, dict):
            for key, value in stored.items():
                if key == 'templates' and isinstance(value, dict):
                    settings['templates'].update(value)
                elif key in DEFAULT_SETTINGS:
                    settings[key] = value
        return settings

    def save_settings(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        settings = self.get_settings()
        if 'enabled' in patch:
            settings['enabled'] = bool(patch['enabled'])
        if 'time' in patch:
            settings['time'] = self._normalise_time(patch['time'], settings['time'])
        if 'timezone' in patch and isinstance(patch['timezone'], str) and patch['timezone'].strip():
            settings['timezone'] = patch['timezone'].strip()
        if 'categories' in patch and isinstance(patch['categories'], list):
            allowed = [c for c in patch['categories'] if c in STATUS_LABELS]
            settings['categories'] = allowed or settings['categories']
        if 'weekdays' in patch and isinstance(patch['weekdays'], list):
            days = sorted({int(d) for d in patch['weekdays'] if isinstance(d, (int, float)) and 0 <= int(d) <= 6})
            settings['weekdays'] = days or settings['weekdays']
        if 'templates' in patch and isinstance(patch['templates'], dict):
            for key, value in patch['templates'].items():
                if key in STATUS_LABELS and isinstance(value, str) and value.strip():
                    settings['templates'][key] = value.strip()
        sqlite_db.save_setting(SETTINGS_KEY, settings)
        return settings

    @staticmethod
    def _normalise_time(raw: Any, fallback: str) -> str:
        try:
            hour, minute = str(raw).strip().split(':')[:2]
            return f"{int(hour):02d}:{int(minute):02d}"
        except Exception:
            return fallback

    # ── التوقيت ──────────────────────────────────────────────

    def now_local(self, settings: Optional[Dict[str, Any]] = None) -> datetime:
        settings = settings or self.get_settings()
        tz = _tz(settings.get('timezone') or DEFAULT_TIMEZONE)
        now = self._clock()
        if tz is None:
            return now
        if now.tzinfo is None:
            return now.astimezone(tz) if hasattr(now, 'astimezone') else now
        return now.astimezone(tz)

    def run_key_for(self, local_now: datetime, settings: Dict[str, Any]) -> str:
        return f"attendance:{local_now.date().isoformat()}:{settings['time']}"

    def next_run_at(self, settings: Optional[Dict[str, Any]] = None) -> Optional[str]:
        settings = settings or self.get_settings()
        if not settings.get('enabled'):
            return None
        local_now = self.now_local(settings)
        hour, minute = (int(part) for part in settings['time'].split(':'))
        candidate = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        for _ in range(8):
            if candidate > local_now and candidate.weekday() in settings['weekdays']:
                return candidate.isoformat()
            candidate += timedelta(days=1)
        return None

    def is_due(self, settings: Dict[str, Any], local_now: datetime) -> bool:
        if not settings.get('enabled'):
            return False
        if local_now.weekday() not in settings.get('weekdays', []):
            return False
        return local_now.strftime('%H:%M') >= settings['time']

    # ── التشغيل ──────────────────────────────────────────────

    def build_rows(self, settings: Dict[str, Any], local_now: datetime) -> List[Dict[str, Any]]:
        """حوّل صفوف المصدر إلى صفوف طابور بمعرّفات ثابتة."""
        if self._source is None:
            return []
        date_str = local_now.date().isoformat()
        categories = [c for c in settings['categories'] if c in STATUS_LABELS]
        raw = self._source(date_str, categories) or []
        rows: List[Dict[str, Any]] = []
        for record in raw:
            category = record.get('category')
            if category not in categories:
                continue
            phone = _clean_phone(record.get('phone') or record.get('guardian_phone'))
            if not phone:
                continue
            student_id = str(record.get('student_id') or record.get('id') or phone)
            name = str(record.get('student_name') or record.get('name') or 'الطالب')
            template = settings['templates'].get(category, DEFAULT_TEMPLATES[category])
            message = (
                template
                .replace('{StudentName}', name)
                .replace('{Date}', date_str)
                .replace('{Time}', str(record.get('time') or local_now.strftime('%H:%M')))
            )
            rows.append({
                # نفس صيغة المعرّف المستعملة في الواجهة
                # (attendanceNotificationService و ustadHader/absenceAlerts):
                # "{النوع}:{معرّف الطالب}:{التاريخ}". التطابق مقصود — الطابور يتجاهل
                # المعرّف المكرر، فلو أنشأ الخادم إشعاراً وأنشأت الواجهة الإشعار نفسه
                # وصل ولي الأمر رسالة واحدة لا رسالتين.
                'id': f"{category}:{student_id}:{date_str}",
                'phone': phone,
                'message': message,
                'student_name': name,
                'status_label': STATUS_LABELS[category],
                'status': 'pending',
            })
        return rows

    def run_once(self, *, force: bool = False, simulate: bool = False) -> Dict[str, Any]:
        """نفّذ جدولة اليوم إن حان وقتها.

        ``simulate=True`` يبني الصفوف ويعيد ملخصها دون كتابة أي شيء — لا صف في
        الطابور ولا حجز للتشغيل — وهو ما تُختبر به الجدولة بأمان على نظام يعمل.
        """
        with self._lock:
            settings = self.get_settings()
            local_now = self.now_local(settings)

            if not force and not self.is_due(settings, local_now):
                return {'ran': False, 'reason': 'not_due', 'queued': 0,
                        'next_run_at': self.next_run_at(settings)}

            run_key = self.run_key_for(local_now, settings)

            if simulate:
                rows = self.build_rows(settings, local_now)
                return {'ran': False, 'reason': 'simulated', 'simulated': True,
                        'run_key': run_key, 'would_queue': len(rows),
                        'rows': rows}

            if not sqlite_db.claim_schedule_run(run_key):
                return {'ran': False, 'reason': 'already_ran_today', 'queued': 0,
                        'run_key': run_key}

            rows = self.build_rows(settings, local_now)
            queued = 0
            if rows:
                queued = self._enqueue(rows) or 0
            sqlite_db.record_schedule_run(run_key, queued)
            logging.info(
                f"🗓️ جدولة الحضور ({run_key}): أُضيف {queued} من {len(rows)} إشعاراً إلى الطابور. "
                "الإرسال لم يبدأ."
            )
            return {'ran': True, 'reason': 'queued', 'queued': queued,
                    'built': len(rows), 'run_key': run_key}

    # ── الخيط الخلفي ─────────────────────────────────────────

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name='attendance-scheduler', daemon=True)
        self._thread.start()
        logging.info("🗓️ جدولة إشعارات الحضور تعمل على الخادم")

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self._tick_seconds):
            try:
                self.run_once()
            except Exception as exc:  # pragma: no cover - defensive
                logging.error(f"🗓️ خطأ في جدولة الحضور: {exc}", exc_info=True)


# ── مصدر البيانات الافتراضي ──────────────────────────────────

def supabase_source(date_str: str, categories: Sequence[str]) -> List[Dict[str, Any]]:
    """اجلب المتأخرين والغائبين من Supabase عبر REST دون اعتماديات إضافية.

    يعيد قائمة فارغة بهدوء إن لم تُضبط بيانات Supabase، لأن الخادم قد يُشغَّل
    للإرسال اليدوي فقط.
    """
    import json as _json
    import os
    import urllib.parse
    import urllib.request

    base = (os.environ.get('VITE_SUPABASE_URL') or '').strip().rstrip('/')
    key = (os.environ.get('VITE_SUPABASE_ANON_KEY') or '').strip()
    if not base or not key:
        logging.warning("🗓️ الجدولة بلا مصدر بيانات: VITE_SUPABASE_URL/ANON_KEY غير مضبوطة")
        return []

    status_filter = ','.join(categories)
    query = urllib.parse.urlencode({
        'select': 'student_id,status,timestamp,students(name,guardian_phone)',
        'date': f'eq.{date_str}',
        'status': f'in.({status_filter})',
    })
    request = urllib.request.Request(
        f"{base}/rest/v1/attendance_logs?{query}",
        headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Accept': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = _json.loads(response.read().decode('utf-8'))
    except Exception as exc:
        logging.error(f"🗓️ تعذّر جلب بيانات الحضور: {exc}")
        return []

    rows: List[Dict[str, Any]] = []
    for record in payload or []:
        student = record.get('students') or {}
        rows.append({
            'student_id': record.get('student_id'),
            'student_name': student.get('name'),
            'phone': student.get('guardian_phone'),
            'category': record.get('status'),
            'time': (record.get('timestamp') or '')[11:16],
        })
    return rows
