import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import sqlite_db
from scheduler import AttendanceScheduler, DEFAULT_SETTINGS


# بيانات محاكاة بالكامل: أرقام محجوزة للاختبار ولا تُرسل إلى أي جهة.
MOCK_ROWS = [
    {'student_id': 's1', 'student_name': 'طالب أول', 'phone': '966500000001', 'category': 'late', 'time': '07:35'},
    {'student_id': 's2', 'student_name': 'طالب ثانٍ', 'phone': '٩٦٦٥٠٠٠٠٠٠٠٢', 'category': 'absent'},
    {'student_id': 's3', 'student_name': 'بلا رقم', 'phone': '', 'category': 'absent'},
    {'student_id': 's4', 'student_name': 'نوع غير مطلوب', 'phone': '966500000004', 'category': 'excused'},
]


class SchedulerTestBase(unittest.TestCase):
    def setUp(self):
        sqlite_db.init_db()
        with sqlite_db.get_db() as conn:
            conn.execute("DELETE FROM app_settings WHERE key = 'attendance_schedule'")
            conn.execute("DELETE FROM schedule_runs WHERE run_key LIKE 'attendance:2026-09-16%'")
            conn.execute("DELETE FROM queue WHERE id LIKE '%:2026-09-16'")
        self.enqueued = []

    def tearDown(self):
        with sqlite_db.get_db() as conn:
            conn.execute("DELETE FROM app_settings WHERE key = 'attendance_schedule'")
            conn.execute("DELETE FROM schedule_runs WHERE run_key LIKE 'attendance:2026-09-16%'")
            conn.execute("DELETE FROM queue WHERE id LIKE '%:2026-09-16'")

    def make(self, *, hour=9, minute=5, rows=None, enqueue=None):
        # 2026-09-16 هو يوم أربعاء — ضمن أيام الدوام الافتراضية.
        fixed = datetime(2026, 9, 16, hour, minute, tzinfo=timezone.utc)
        sched = AttendanceScheduler(
            source=lambda date_str, cats: list(rows if rows is not None else MOCK_ROWS),
            enqueue=enqueue or (lambda items: (self.enqueued.extend(items), len(items))[1]),
            clock=lambda: fixed,
        )
        return sched


class TestSettingsPersistence(SchedulerTestBase):
    def test_settings_survive_a_new_instance(self):
        """الإعدادات في قاعدة البيانات لا في المتصفح: نسخة جديدة تقرأ نفس القيم."""
        first = self.make()
        first.save_settings({'enabled': True, 'time': '7:5', 'timezone': 'Asia/Riyadh'})

        second = self.make()
        saved = second.get_settings()
        self.assertTrue(saved['enabled'])
        self.assertEqual(saved['time'], '07:05')
        self.assertEqual(saved['timezone'], 'Asia/Riyadh')

    def test_bad_values_fall_back_instead_of_corrupting_the_schedule(self):
        sched = self.make()
        sched.save_settings({'time': 'not-a-time', 'categories': ['nonsense'], 'weekdays': [99]})
        saved = sched.get_settings()
        self.assertEqual(saved['time'], DEFAULT_SETTINGS['time'])
        self.assertEqual(saved['categories'], DEFAULT_SETTINGS['categories'])
        self.assertEqual(saved['weekdays'], DEFAULT_SETTINGS['weekdays'])


class TestTimezone(SchedulerTestBase):
    def test_the_school_timezone_decides_not_the_server_clock(self):
        """09:05 بتوقيت UTC هو 12:05 بالرياض: الموعد 09:00 يكون قد حان بالرياض."""
        sched = self.make(hour=9, minute=5)
        sched.save_settings({'enabled': True, 'time': '09:00', 'timezone': 'Asia/Riyadh'})
        settings = sched.get_settings()
        local = sched.now_local(settings)
        self.assertEqual(local.strftime('%H:%M'), '12:05')
        self.assertTrue(sched.is_due(settings, local))

    def test_before_the_school_time_nothing_runs(self):
        """05:00 بتوقيت UTC هي 08:00 بالرياض — قبل الموعد."""
        sched = self.make(hour=5, minute=0)
        sched.save_settings({'enabled': True, 'time': '09:00', 'timezone': 'Asia/Riyadh'})
        result = sched.run_once()
        self.assertFalse(result['ran'])
        self.assertEqual(result['reason'], 'not_due')
        self.assertEqual(self.enqueued, [])

    def test_a_non_school_day_is_skipped(self):
        sched = self.make(hour=9)
        sched.save_settings({'enabled': True, 'time': '09:00', 'weekdays': [4]})  # الجمعة فقط
        settings = sched.get_settings()
        self.assertFalse(sched.is_due(settings, sched.now_local(settings)))


class TestRowBuilding(SchedulerTestBase):
    def test_rows_are_filtered_and_normalised(self):
        sched = self.make()
        sched.save_settings({'enabled': True, 'time': '09:00'})
        result = sched.run_once()

        self.assertTrue(result['ran'])
        self.assertEqual(len(self.enqueued), 2)  # بلا رقم، ونوع غير مطلوب: مستبعدان

        by_id = {row['id']: row for row in self.enqueued}
        self.assertIn('late:s1:2026-09-16', by_id)
        self.assertIn('absent:s2:2026-09-16', by_id)

        # الأرقام العربية تُحوَّل، والقالب يملأ الاسم والتاريخ والوقت
        self.assertEqual(by_id['absent:s2:2026-09-16']['phone'], '966500000002')
        late = by_id['late:s1:2026-09-16']
        self.assertIn('طالب أول', late['message'])
        self.assertIn('2026-09-16', late['message'])
        self.assertIn('07:35', late['message'])
        self.assertEqual(late['status_label'], 'تأخر')

    def test_disabled_schedule_builds_nothing(self):
        sched = self.make()
        sched.save_settings({'enabled': False})
        result = sched.run_once()
        self.assertFalse(result['ran'])
        self.assertEqual(self.enqueued, [])


class TestNoDuplicates(SchedulerTestBase):
    def test_a_second_run_on_the_same_day_is_refused(self):
        sched = self.make()
        sched.save_settings({'enabled': True, 'time': '09:00'})

        first = sched.run_once()
        second = sched.run_once()

        self.assertTrue(first['ran'])
        self.assertFalse(second['ran'])
        self.assertEqual(second['reason'], 'already_ran_today')
        self.assertEqual(len(self.enqueued), 2)

    def test_a_restart_does_not_repeat_the_run(self):
        """نسخة جديدة من الجدولة — كما بعد إعادة تشغيل الخدمة — لا تُعيد اليوم."""
        self.make().save_settings({'enabled': True, 'time': '09:00'})
        self.make().run_once()
        after_restart = self.make().run_once()
        self.assertEqual(after_restart['reason'], 'already_ran_today')

    def test_identical_ids_are_ignored_by_the_queue_itself(self):
        """حتى لو وصلت الصفوف مرتين، الطابور يتجاهل المعرّف المكرر."""
        sched = self.make(enqueue=sqlite_db.append_to_queue)
        sched.save_settings({'enabled': True, 'time': '09:00'})

        first = sched.run_once()
        self.assertEqual(first['queued'], 2)

        rows = sched.build_rows(sched.get_settings(), sched.now_local())
        second_attempt = sqlite_db.append_to_queue(rows)
        self.assertEqual(second_attempt, 0)


class TestSimulation(SchedulerTestBase):
    def test_simulation_writes_nothing(self):
        """المحاكاة تعرض ما كان سيحدث دون إضافة رسالة واحدة ولا حجز اليوم."""
        sched = self.make(enqueue=sqlite_db.append_to_queue)
        sched.save_settings({'enabled': True, 'time': '09:00'})

        before = sqlite_db.get_stats()['total']
        result = sched.run_once(simulate=True)
        after = sqlite_db.get_stats()['total']

        self.assertTrue(result['simulated'])
        self.assertEqual(result['would_queue'], 2)
        self.assertEqual(before, after)
        self.assertEqual(sqlite_db.get_schedule_runs(5), [
            r for r in sqlite_db.get_schedule_runs(5) if not r['run_key'].startswith('attendance:2026-09-16')
        ])

    def test_simulation_leaves_the_real_run_still_available(self):
        sched = self.make()
        sched.save_settings({'enabled': True, 'time': '09:00'})
        sched.run_once(simulate=True)
        real = sched.run_once()
        self.assertTrue(real['ran'])


class TestSchedulerNeverSends(SchedulerTestBase):
    def test_running_the_schedule_only_queues(self):
        """الجدولة تضيف إلى الطابور فقط — لا تملك أي مسار لبدء الإرسال."""
        sched = self.make()
        sched.save_settings({'enabled': True, 'time': '09:00'})
        result = sched.run_once()
        self.assertTrue(result['ran'])
        self.assertNotIn('sending', result)
        for row in self.enqueued:
            self.assertEqual(row['status'], 'pending')


if __name__ == '__main__':
    unittest.main()
