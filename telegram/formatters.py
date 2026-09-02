"""
Hader Telegram Bot - Message Formatters
═══════════════════════════════════════
Formats attendance events into rich Telegram messages (HTML parse mode).
Reads kiosk settings (assembly_time, grace_period) from Supabase.
"""

import logging
from datetime import datetime, timedelta, timezone

from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY

logger = logging.getLogger('hader.formatters')

# Riyadh Timezone (UTC+3)
RIYADH_TZ = timezone(timedelta(hours=3))

# ═══════════════════════════════════════════════════════════════
# Kiosk Settings Cache (assembly_time, grace_period)
# ═══════════════════════════════════════════════════════════════
_DEFAULTS = {'assembly_time': '07:00', 'grace_period': 15}
_settings_cache: dict = {'data': None, 'time': None}
_fmt_supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def get_kiosk_settings() -> dict:
    """
    Fetch assembly_time & grace_period from Supabase settings table.
    Cached for 5 minutes to avoid excessive queries.
    Returns dict with 'assembly_time' (str HH:MM) and 'grace_period' (int minutes).
    """
    now = datetime.now()
    cached = _settings_cache.get('data')
    cached_time = _settings_cache.get('time')

    if cached and cached_time and (now - cached_time) < timedelta(minutes=5):
        return cached

    try:
        res = _fmt_supabase.table('settings').select(
            'assembly_time, grace_period, kiosk_settings'
        ).limit(1).execute()
        row = res.data[0] if res.data else {}

        # Priority: kiosk_settings JSONB > root-level columns > defaults
        ks = row.get('kiosk_settings') or {}
        if isinstance(ks, str):
            ks = {}

        result = {
            'assembly_time': ks.get('assembly_time') or row.get('assembly_time') or _DEFAULTS['assembly_time'],
            'grace_period': ks.get('grace_period') if ks.get('grace_period') is not None
                            else (row.get('grace_period') if row.get('grace_period') is not None
                                  else _DEFAULTS['grace_period']),
        }

        _settings_cache['data'] = result
        _settings_cache['time'] = now
        logger.info(f"⚙️ Kiosk settings loaded: assembly={result['assembly_time']}, grace={result['grace_period']}min")
        return result

    except Exception as e:
        logger.error(f'Failed to fetch kiosk settings: {e}')
        return cached or _DEFAULTS


def get_cutoff_time_str() -> str:
    """Calculate cutoff time string (assembly_time + grace_period)."""
    s = get_kiosk_settings()
    try:
        h, m = map(int, s['assembly_time'].split(':'))
        cutoff = h * 60 + m + s['grace_period']
        return f"{cutoff // 60:02d}:{cutoff % 60:02d}"
    except Exception:
        return '07:15'


def save_kiosk_settings(assembly_time: str | None = None, grace_period: int | None = None) -> bool:
    """
    Save assembly_time and/or grace_period to Supabase settings table.
    Updates both root-level columns AND kiosk_settings JSONB for compatibility.
    Clears cache so bot picks up changes immediately.
    Returns True on success.
    """
    try:
        # First, read current kiosk_settings to merge
        current = _fmt_supabase.table('settings').select('kiosk_settings').limit(1).execute()
        ks = {}
        if current.data:
            ks = current.data[0].get('kiosk_settings') or {}
            if isinstance(ks, str):
                ks = {}

        update_payload: dict = {}

        if assembly_time is not None:
            update_payload['assembly_time'] = assembly_time
            ks['assembly_time'] = assembly_time

        if grace_period is not None:
            update_payload['grace_period'] = grace_period
            ks['grace_period'] = grace_period

        update_payload['kiosk_settings'] = ks

        _fmt_supabase.table('settings').update(update_payload).eq('id', '00000000-0000-0000-0000-000000000000').execute()

        # Clear cache so changes are picked up immediately
        _settings_cache['data'] = None
        _settings_cache['time'] = None

        logger.info(f'✅ Kiosk settings saved: {update_payload}')
        return True

    except Exception as e:
        logger.error(f'Failed to save kiosk settings: {e}')
        return False

DAYS_MAP = {
    'Sunday': 'الأحد',
    'Monday': 'الاثنين',
    'Tuesday': 'الثلاثاء',
    'Wednesday': 'الأربعاء',
    'Thursday': 'الخميس',
    'Friday': 'الجمعة',
    'Saturday': 'السبت'
}

def _to_riyadh(ts: str | None) -> datetime | None:
    """Convert ISO timestamp to Riyadh datetime."""
    if not ts:
        return None
    try:
        # Handle 'Z' manually if python < 3.11 doesn't like it combined with other things,
        # but fromisoformat handles 'Z' in newer pythons. Safety replace:
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return dt.astimezone(RIYADH_TZ)
    except Exception:
        return None

def _time_str(ts: str | None) -> str:
    """Get HH:MM in Riyadh time."""
    dt = _to_riyadh(ts)
    if not dt:
        return '—'
    # 12-hour format with AM/PM converted to Arabic if possible, or just 24h
    # Let's stick to 12h for better readability
    return dt.strftime('%I:%M %p').replace('AM', 'ص').replace('PM', 'م')

def _date_str(ts: str | None) -> str:
    """Get 'DayName, YYYY-MM-DD' in Riyadh time."""
    dt = _to_riyadh(ts)
    if not dt:
        return '—'
    
    day_name_en = dt.strftime('%A')
    day_name_ar = DAYS_MAP.get(day_name_en, day_name_en)
    date_part = dt.strftime('%Y-%m-%d')
    return f"{day_name_ar}، {date_part}"

def _source_label(label: str | None) -> str:
    """Convert recorded_by_label to Arabic display name."""
    mapping = {
        'kiosk': '🖥️ الكشك الذكي',
        'mobile': '📱 ماسح الجوال',
        'admin-manual': '👨‍💼 المشرف (يدوي)',
        'admin-bulk': '👨‍💼 المشرف (جماعي)',
        'local-admin': '👨‍💼 المشرف',
        'watcher': '👁️ المراقب',
        'system': '⚙️ النظام الآلي',
    }
    return mapping.get(label or '', f'📱 {label}' if label else '📱 غير محدد')


def _source_emoji(label: str | None) -> str:
    """Return a single emoji representing the attendance source."""
    if not label:
        return '📱'
    label_lower = label.lower()
    if 'kiosk' in label_lower:
        return '🖥'
    elif any(k in label_lower for k in ('admin', 'watcher', 'supervisor')):
        return '👨‍💼'
    else:
        return '📱'


# ═══════════════════════════════════════════════════════════════
# Attendance Messages
# ═══════════════════════════════════════════════════════════════

def format_attendance(record: dict, student: dict | None = None) -> tuple[str, str | None, str]:
    """
    Format an attendance record into a Telegram message.
    Returns (primary_channel, secondary_channel, html_message).
    - primary_channel: always 'kiosk' (unified الحضور الإجمالي)
    - secondary_channel: 'absences' or 'late' if applicable, else None
    """
    status = record.get('status', 'present')
    is_late = status == 'late'
    is_absent = status == 'absent'
    source_label = record.get('recorded_by_label', '')
    source_icon = _source_emoji(source_label)

    # Primary channel is always the unified channel
    primary = 'kiosk'
    # Secondary channel for duplicates
    secondary = None
    if is_absent:
        secondary = 'absences'
    elif is_late:
        secondary = 'late'

    student_name = (student or {}).get('name', '') or record.get('student_name', 'غير معروف')
    student_id = record.get('student_id', '—')
    class_name = (student or {}).get('class_name', '')
    section = (student or {}).get('section', '')
    class_display = f'{class_name} / {section}' if class_name and section else class_name or '—'
    minutes_late = record.get('minutes_late', 0)
    
    # Use formatted Riyadh times
    time_str = _time_str(record.get('timestamp'))
    date_str = _date_str(record.get('timestamp'))

    # Kiosk timing context
    ks = get_kiosk_settings()
    cutoff = get_cutoff_time_str()

    if is_late:
        emoji = '⚠️'
        title = 'تأخر طالب'
        status_line = f'⏳ <b>مدة التأخر:</b> {minutes_late} دقيقة'
    elif is_absent:
        emoji = '❌'
        title = 'غياب طالب'
        status_line = '✨ <b>الحالة:</b> غائب'
    else:
        emoji = '✅'
        title = 'حضور طالب'
        status_line = '✨ <b>الحالة:</b> حاضر'

    # Timing info line
    timing_line = f'🔔 <b>الطابور:</b> {ks["assembly_time"]} | <b>حد التأخر:</b> {cutoff}'

    msg = (
        f'{emoji} <b>{title}</b> {source_icon}\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'👤 <b>الطالب:</b> {student_name}\n'
        f'🔢 <b>الرقم:</b> <code>{student_id}</code>\n'
        f'🏫 <b>الفصل:</b> {class_display}\n'
        f'⏰ <b>الوقت:</b> {time_str}\n'
        f'📅 <b>التاريخ:</b> {date_str}\n'
        f'{status_line}\n'
        f'{timing_line}\n'
        f'📡 <b>المصدر:</b> {_source_label(source_label)}'
    )
    return primary, secondary, msg


# ═══════════════════════════════════════════════════════════════
# Exit Messages
# ═══════════════════════════════════════════════════════════════

def format_exit(record: dict, student: dict | None = None) -> str:
    """Format an exit/permission record."""
    student_name = (student or {}).get('name', '') or record.get('student_name', 'غير معروف')
    student_id = record.get('student_id', '—')
    class_name = (student or {}).get('class_name', '')
    reason = record.get('reason', '—')
    
    exit_time = _time_str(record.get('exit_time'))
    exit_date = _date_str(record.get('exit_time'))

    return (
        f'🚪 <b>تصريح خروج / استئذان</b>\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'👤 <b>الطالب:</b> {student_name}\n'
        f'🔢 <b>الرقم:</b> <code>{student_id}</code>\n'
        f'🏫 <b>الفصل:</b> {class_name}\n'
        f'⏰ <b>وقت الخروج:</b> {exit_time}\n'
        f'📅 <b>التاريخ:</b> {exit_date}\n'
        f'📝 <b>السبب:</b> {reason}'
    )


# ═══════════════════════════════════════════════════════════════
# Stats / Report Messages
# ═══════════════════════════════════════════════════════════════

def format_daily_stats(stats: dict) -> str:
    """Format daily statistics summary with kiosk timing info."""
    total = stats.get('total', 0)
    present = stats.get('present', 0)
    late = stats.get('late', 0)
    absent = stats.get('absent', 0)
    rate = stats.get('rate', 0)

    # Simple progress bar
    bar_len = 15
    filled = int(rate / 100 * bar_len) if total > 0 else 0
    bar = '▓' * filled + '░' * (bar_len - filled)
    
    current_time = datetime.now(RIYADH_TZ).strftime('%I:%M %p').replace('AM', 'ص').replace('PM', 'م')

    # Kiosk timing
    ks = get_kiosk_settings()
    cutoff = get_cutoff_time_str()

    return (
        f'📊 <b>التقرير اليومي المختصر</b>\n'
        f'🕒 <i>توقيت التقرير: {current_time}</i>\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'🔔 <b>وقت الطابور:</b> {ks["assembly_time"]}\n'
        f'⏳ <b>مهلة التأخر:</b> {ks["grace_period"]} دقيقة (حتى {cutoff})\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'👥 <b>إجمالي الطلاب:</b> {total}\n'
        f'✅ <b>حضور:</b> {present}\n'
        f'⚠️ <b>تأخر:</b> {late}\n'
        f'❌ <b>غياب:</b> {absent}\n'
        f'━━━━━━━━━━━━━━━━━━\n'
        f'📈 <b>نسبة الحضور:</b> %{rate:.1f}\n'
        f'<code>{bar}</code>'
    )


def format_student_list(title: str, emoji: str, students: list[dict]) -> str:
    """Format a list of students (for /absent, /late commands)."""
    if not students:
        return f'{emoji} <b>{title}</b>\n\n✅ لا توجد سجلات حتى الآن.'

    count = len(students)
    header = f'{emoji} <b>{title}</b>\n🔢 العدد: {count} طالب\n━━━━━━━━━━━━━━━━━━\n'
    
    lines = []
    for i, s in enumerate(students[:40], 1):  # Limit to 40 to avoid message length limits
        name = s.get('name', 'غير معروف')
        class_name = s.get('class_name', '')
        section = s.get('section', '')
        cls = f'{class_name}/{section}' if section else class_name
        
        # Details
        details = []
        if s.get('minutes_late'):
            details.append(f'{s["minutes_late"]}د')
        
        # Time check if available (e.g. for late list)
        # Note: students list might not have timestamp directly attached depending on query, 
        # but if we passed enriched dicts:
        if s.get('timestamp'):
             details.append(_time_str(s['timestamp']))

        extra = f' ({", ".join(details)})' if details else ''
        
        lines.append(f'<b>{i}.</b> {name} <code>[{cls}]</code>{extra}')

    body = '\n'.join(lines)
    if count > 40:
        body += f'\n\n... و {count - 40} آخرين'

    return header + body
