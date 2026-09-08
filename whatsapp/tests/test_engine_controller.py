"""
Unit tests for whatsapp/engine_controller.py using a fake bot (no Selenium).

Run:  python3 -m unittest whatsapp/tests/test_engine_controller.py -v
"""
import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine_controller import (  # noqa: E402
    EngineController, sanitize_mission_options, DEFAULT_MISSION_OPTIONS, ENGINE_ALIVE_STATES,
)


class FakeBot:
    """Scriptable stand-in for WhatsAppProTool."""

    def __init__(self, *, init_ok=True, open_ok=True, login_after=0.0, login_ok=True,
                 mission_delay=0.05, mission_result=None):
        self.init_ok = init_ok
        self.open_ok = open_ok
        self.login_after = login_after
        self.login_ok = login_ok
        self.mission_delay = mission_delay
        self.mission_result = mission_result or {"sent": 2, "failed": 0, "skipped": 0}
        self.logged_in_flag = threading.Event()
        self.on_event = None
        self.sending = False
        self.paused = False
        self.closed = False
        self.calls = []
        self.focus_calls = 0
        self.last_activity_time = time.time()
        self.stats = {"sent": 0, "failed": 0, "skipped": 0}
        self.mission_options = None
        self._stop = threading.Event()
        self.mission_started = threading.Event()
        self.release_mission = threading.Event()

    # lifecycle
    def init_browser(self):
        self.calls.append('init_browser')
        return self.init_ok

    def open_whatsapp(self):
        self.calls.append('open_whatsapp')
        return self.open_ok

    def wait_for_login(self, timeout=None, should_continue=None):
        self.calls.append('wait_for_login')
        deadline = time.time() + (timeout or 5)
        started = time.time()
        while time.time() < deadline:
            if should_continue and not should_continue():
                return False
            if self.login_ok and (time.time() - started) >= self.login_after:
                self.logged_in_flag.set()
                return True
            time.sleep(0.01)
        return False

    def is_logged_in(self):
        return self.logged_in_flag.is_set()

    def bring_to_front(self):
        self.focus_calls += 1
        self.calls.append('bring_to_front')
        return True

    def run_mission(self, **options):
        self.calls.append('run_mission')
        self.mission_options = options
        self.sending = True
        self._stop.clear()
        self.mission_started.set()
        if self.release_mission.is_set() or self.mission_delay == 0:
            pass
        else:
            deadline = time.time() + self.mission_delay
            while time.time() < deadline and not self._stop.is_set():
                time.sleep(0.005)
        # block until released when a test wants to observe the sending state
        while self.release_mission.is_set() is False and options.get('_hold'):
            if self._stop.is_set():
                break
            time.sleep(0.005)
        self.sending = False
        result = dict(self.mission_result)
        if self._stop.is_set():
            result['stopped'] = True
        self.stats = {k: result.get(k, 0) for k in ('sent', 'failed', 'skipped')}
        return result

    def pause(self):
        self.calls.append('pause')
        self.paused = True

    def resume(self):
        self.calls.append('resume')
        self.paused = False

    def stop_sending(self):
        self.calls.append('stop_sending')
        self._stop.set()

    def request_focus(self):
        self.focus_calls += 1
        self.calls.append('request_focus')

    def close(self):
        self.calls.append('close')
        self.closed = True


def wait_for(predicate, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class SanitizeOptionsTest(unittest.TestCase):
    def test_defaults_and_coercion(self):
        opts = sanitize_mission_options(None)
        self.assertEqual(opts, DEFAULT_MISSION_OPTIONS)
        opts = sanitize_mission_options({'batch_size': '3', 'min_delay': '40', 'max_delay': '5', 'continuous': True, 'junk': 1})
        self.assertEqual(opts['batch_size'], 3)
        self.assertEqual(opts['min_delay'], 40)
        self.assertEqual(opts['max_delay'], 40)   # clamped up to min_delay
        self.assertTrue(opts['continuous'])
        self.assertNotIn('junk', opts)

    def test_bounds(self):
        opts = sanitize_mission_options({'batch_size': 0, 'long_break': 99999, 'min_delay': 'abc'})
        self.assertEqual(opts['batch_size'], 1)
        self.assertEqual(opts['long_break'], 3600)
        self.assertEqual(opts['min_delay'], DEFAULT_MISSION_OPTIONS['min_delay'])


class EngineControllerTest(unittest.TestCase):
    def make(self, bot, **kw):
        self.events = []
        controller = EngineController(
            lambda: bot,
            on_change=lambda snap: self.events.append(snap['state']),
            login_timeout=kw.pop('login_timeout', 2),
            idle_poll_interval=0.02,
            heartbeat_interval=kw.pop('heartbeat_interval', 0.05),
            **kw,
        )
        self.addCleanup(lambda: (controller.stop_engine(), controller.join(2)))
        return controller

    def test_start_engine_parks_in_ready_without_sending(self):
        bot = FakeBot()
        controller = self.make(bot)
        ok, message, code = controller.start_engine()
        self.assertTrue(ok)
        self.assertEqual(code, 202)
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        snap = controller.snapshot()
        self.assertTrue(snap['running'])
        self.assertTrue(snap['logged_in'])
        self.assertFalse(snap['sending'])
        time.sleep(0.1)
        self.assertNotIn('run_mission', bot.calls)
        self.assertEqual(bot.calls[:3], ['init_browser', 'open_whatsapp', 'wait_for_login'])
        self.assertIn('initializing', self.events)
        self.assertIn('waiting_login', self.events)

    def test_double_start_is_rejected(self):
        bot = FakeBot()
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state in ('waiting_login', 'ready')))
        ok, _, code = controller.start_engine()
        self.assertFalse(ok)
        self.assertEqual(code, 409)
        self.assertEqual(bot.calls.count('init_browser'), 1)

    def test_start_sending_focuses_window_then_runs_mission_and_returns_to_ready(self):
        bot = FakeBot(mission_result={"sent": 3, "failed": 1, "skipped": 0})
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        ok, message, code = controller.start_sending({'batch_size': 4, 'continuous': False})
        self.assertTrue(ok)
        self.assertEqual(code, 202)
        self.assertTrue(wait_for(lambda: 'run_mission' in bot.calls))
        self.assertTrue(wait_for(lambda: controller.state == 'ready' and controller.last_result is not None))
        self.assertEqual(bot.calls.index('bring_to_front'), bot.calls.index('run_mission') - 1)
        self.assertEqual(bot.mission_options['batch_size'], 4)
        self.assertIn('3 نجحت', controller.message)
        self.assertIn('1 فشلت', controller.message)
        self.assertFalse(bot.closed)
        self.assertIn('sending', self.events)

    def test_start_sending_requires_login(self):
        bot = FakeBot(login_after=10)
        controller = self.make(bot, login_timeout=20)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'waiting_login'))
        ok, message, code = controller.start_sending()
        self.assertFalse(ok)
        self.assertEqual(code, 409)
        self.assertIn('QR', message)

    def test_start_sending_requires_engine(self):
        controller = self.make(FakeBot())
        ok, message, code = controller.start_sending()
        self.assertFalse(ok)
        self.assertEqual(code, 409)
        ok, message, code = controller.focus_window()
        self.assertFalse(ok)

    def test_pause_resume_and_stop_sending_keep_browser_open(self):
        bot = FakeBot()
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        controller.start_sending({'_hold': True})
        self.assertTrue(bot.mission_started.wait(2))
        self.assertTrue(wait_for(lambda: controller.state == 'sending'))

        ok, _, _ = controller.pause_sending()
        self.assertTrue(ok)
        self.assertEqual(controller.state, 'paused')
        self.assertTrue(bot.paused)
        self.assertTrue(controller.snapshot()['paused'])

        ok, _, _ = controller.start_sending()     # "إبدأ الإرسال" while paused == resume
        self.assertTrue(ok)
        self.assertEqual(controller.state, 'sending')
        self.assertFalse(bot.paused)

        ok, _, code = controller.stop_sending()
        self.assertTrue(ok)
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        self.assertIn('stop_sending', bot.calls)
        self.assertFalse(bot.closed)
        self.assertIn('تم إيقاف الإرسال', controller.message)

    def test_focus_window_when_ready_and_when_sending(self):
        bot = FakeBot()
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        before = bot.focus_calls
        ok, _, _ = controller.focus_window()
        self.assertTrue(ok)
        self.assertTrue(wait_for(lambda: bot.focus_calls == before + 1))

        controller.start_sending({'_hold': True})
        self.assertTrue(wait_for(lambda: controller.state == 'sending'))
        before = bot.focus_calls
        controller.focus_window()
        self.assertEqual(bot.focus_calls, before + 1)
        self.assertIn('request_focus', bot.calls)

    def test_focus_window_while_waiting_for_qr_uses_bot_flag(self):
        bot = FakeBot(login_after=10)
        controller = self.make(bot, login_timeout=30)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'waiting_login'))
        ok, message, code = controller.focus_window()
        self.assertTrue(ok)
        self.assertEqual(code, 202)
        self.assertIn('request_focus', bot.calls)

    def test_stop_engine_closes_browser(self):
        bot = FakeBot()
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        ok, _, code = controller.stop_engine()
        self.assertTrue(ok)
        controller.join(2)
        self.assertEqual(controller.state, 'stopped')
        self.assertTrue(bot.closed)
        self.assertFalse(controller.snapshot()['running'])
        # restart works after a stop
        bot2 = FakeBot()
        controller._bot_factory = lambda: bot2
        ok, _, _ = controller.start_engine()
        self.assertTrue(ok)
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))

    def test_stop_engine_while_waiting_for_login(self):
        bot = FakeBot(login_after=10)
        controller = self.make(bot, login_timeout=30)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'waiting_login'))
        controller.stop_engine()
        controller.join(2)
        self.assertEqual(controller.state, 'stopped')
        self.assertTrue(bot.closed)

    def test_browser_init_failure_reports_error(self):
        bot = FakeBot(init_ok=False)
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'error'))
        self.assertIn('Chrome', controller.message)
        self.assertTrue(bot.closed)
        self.assertFalse(controller.alive)

    def test_login_timeout_reports_error(self):
        bot = FakeBot(login_after=10)
        controller = self.make(bot, login_timeout=0.1)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'error'))
        self.assertIn('QR', controller.message)

    def test_auto_send_option_preserves_legacy_flow(self):
        bot = FakeBot()
        controller = self.make(bot)
        controller.start_engine(auto_send=True)
        self.assertTrue(wait_for(lambda: 'run_mission' in bot.calls))
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))

    def test_heartbeat_detects_logout_and_relogin(self):
        bot = FakeBot()
        controller = self.make(bot, heartbeat_interval=0.03)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        bot.logged_in_flag.clear()
        self.assertTrue(wait_for(lambda: controller.state == 'waiting_login'))
        self.assertFalse(controller.snapshot()['logged_in'])
        bot.logged_in_flag.set()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        self.assertTrue(controller.snapshot()['logged_in'])

    def test_progress_events_update_snapshot(self):
        bot = FakeBot()
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        controller.start_sending({'_hold': True})
        self.assertTrue(wait_for(lambda: controller.state == 'sending'))
        bot.on_event('progress', {'current': 2, 'total': 5, 'sent': 1, 'failed': 0, 'skipped': 0,
                                  'last_phone': '9665', 'last_name': 'أحمد'})
        snap = controller.snapshot()
        self.assertEqual(snap['progress']['current'], 2)
        self.assertEqual(snap['progress']['total'], 5)
        self.assertIn('2/5', snap['state_message'])
        self.assertIn('أحمد', snap['state_message'])

    def test_watchdog_restarts_frozen_mission(self):
        bot = FakeBot()
        controller = self.make(bot)
        controller.start_engine()
        self.assertTrue(wait_for(lambda: controller.state == 'ready'))
        controller.start_sending({'_hold': True})
        self.assertTrue(wait_for(lambda: controller.state == 'sending'))
        self.assertFalse(controller.watchdog_check(max_idle_seconds=300))
        bot.last_activity_time = time.time() - 1000
        bot2 = FakeBot()
        controller._bot_factory = lambda: bot2
        self.assertTrue(controller.watchdog_check(max_idle_seconds=300))
        self.assertTrue(bot.closed)
        self.assertTrue(wait_for(lambda: controller.state in ('ready',) and 'run_mission' in bot2.calls, timeout=5))


if __name__ == '__main__':
    unittest.main()
