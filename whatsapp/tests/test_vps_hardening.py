import os
import sys
import time
import unittest
from unittest.mock import MagicMock, patch

# Ensure whatsapp directory is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import server
import sqlite_db


class TestVpsHardening(unittest.TestCase):
    def setUp(self):
        self.app = server.app.test_client()
        server.API_SECRET_KEY = 'test-secret-key'
        sqlite_db.init_db()

    def tearDown(self):
        server.API_SECRET_KEY = None

    def test_qr_endpoint_requires_auth(self):
        """Testing /api/qr without API key returns 401."""
        response = self.app.get('/api/qr')
        self.assertEqual(response.status_code, 401)

    def test_qr_endpoint_with_auth_returns_qr_info(self):
        """Testing /api/qr with API key returns structured QR response."""
        with patch.object(server.engine, 'get_qr_code', return_value={'qr': 'data:image/png;base64,mockqr', 'authenticated': False, 'state': 'waiting_login'}):
            response = self.app.get('/api/qr', headers={'X-API-Key': 'test-secret-key'})
            self.assertEqual(response.status_code, 200)
            data = response.get_json()
            self.assertEqual(data['state'], 'waiting_login')
            self.assertEqual(data['authenticated'], False)
            self.assertTrue(data['qr'].startswith('data:image/png;base64,'))

    def test_idempotency_key_replay(self):
        """Testing that submitting with identical idempotency key replays cached response."""
        import uuid
        unique_key = f"test-idem-{uuid.uuid4()}"
        payload = [{'phone': '966500000000', 'message': 'Test Idempotency', 'student_name': 'طالب تجريبي'}]
        
        # First submission
        res1 = self.app.post(
            '/api/send',
            json=payload,
            headers={'X-API-Key': 'test-secret-key', 'X-Idempotency-Key': unique_key}
        )
        self.assertEqual(res1.status_code, 200)
        data1 = res1.get_json()
        self.assertFalse(data1.get('idempotent_replay', False))
        
        # Second submission with exact same key
        res2 = self.app.post(
            '/api/send',
            json=payload,
            headers={'X-API-Key': 'test-secret-key', 'X-Idempotency-Key': unique_key}
        )
        self.assertEqual(res2.status_code, 200)
        data2 = res2.get_json()
        self.assertTrue(data2.get('idempotent_replay', False))
        self.assertEqual(data1['saved'], data2['saved'])

    def test_sensitive_log_filter(self):
        """Testing that OptionsFilter suppresses base64 and data:image from logs."""
        log_filter = server.OptionsFilter()
        
        mock_record_sensitive = MagicMock()
        mock_record_sensitive.getMessage.return_value = 'Sending data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...'
        self.assertFalse(log_filter.filter(mock_record_sensitive))
        
        mock_record_qr = MagicMock()
        mock_record_qr.getMessage.return_value = 'Request completed: GET /api/qr HTTP/1.1'
        self.assertFalse(log_filter.filter(mock_record_qr))
        
        mock_record_normal = MagicMock()
        mock_record_normal.getMessage.return_value = '▶️  Starting mission for 5 items'
        self.assertTrue(log_filter.filter(mock_record_normal))

    def test_idempotency_mismatch_different_payload(self):
        """Testing that submitting with identical idempotency key but different payload returns 409 conflict."""
        import uuid
        unique_key = f"test-conflict-{uuid.uuid4()}"
        payload1 = [{'phone': '966500000001', 'message': 'Message Alpha', 'student_name': 'طالب 1'}]
        payload2 = [{'phone': '966500000002', 'message': 'Message Beta', 'student_name': 'طالب 2'}]
        
        # First submission
        res1 = self.app.post(
            '/api/send',
            json=payload1,
            headers={'X-API-Key': 'test-secret-key', 'X-Idempotency-Key': unique_key}
        )
        self.assertEqual(res1.status_code, 200)
        
        # Second submission with exact same key but different body
        res2 = self.app.post(
            '/api/send',
            json=payload2,
            headers={'X-API-Key': 'test-secret-key', 'X-Idempotency-Key': unique_key}
        )
        self.assertEqual(res2.status_code, 409)
        data2 = res2.get_json()
        self.assertEqual(data2.get('error'), 'idempotency_mismatch')

    def test_crash_recovery_and_unconfirmed_atomic_quarantine(self):
        """Testing atomic quarantine: crashed 'confirming' rows become 'unconfirmed' and are NEVER auto-resent."""
        import uuid
        item_id_confirming = f"item-conf-{uuid.uuid4()}"
        item_id_sending = f"item-send-{uuid.uuid4()}"

        sqlite_db.clear_queue()

        # Insert 2 test items
        sqlite_db.append_to_queue([
            {'id': item_id_confirming, 'phone': '966500000010', 'message': 'Sent but crashed before DB ack'},
            {'id': item_id_sending, 'phone': '966500000020', 'message': 'Crashed before clicking send'}
        ])

        # Simulate engine mid-flight state
        sqlite_db.update_status(item_id_confirming, 'confirming')
        sqlite_db.update_status(item_id_sending, 'sending')

        # Simulate crash & restart recovery
        recovered = sqlite_db.reset_stuck_sending()
        self.assertEqual(recovered, 2)

        # Check statuses after recovery
        queue = {item['id']: item for item in sqlite_db.get_queue()}
        self.assertEqual(queue[item_id_confirming]['status'], 'unconfirmed')
        self.assertEqual(queue[item_id_sending]['status'], 'pending')

        # Verify that get_pending_with_retry NEVER picks up 'unconfirmed' items
        pending_to_send = sqlite_db.get_pending_with_retry()
        pending_ids = [p['id'] for p in pending_to_send]
        self.assertIn(item_id_sending, pending_ids)
        self.assertNotIn(item_id_confirming, pending_ids)


if __name__ == '__main__':
    unittest.main()


class TestProductionSecretGate(unittest.TestCase):
    """وضع الإنتاج يرفض الإقلاع بلا مفتاح، ويرفض الطلبات بلا مفتاح أو بمفتاح خاطئ."""

    def _boot(self, env):
        """Re-import server under a given environment and report whether it booted."""
        import importlib
        import subprocess
        code = (
            "import server; "
            "print('BOOTED', server.RUN_ENV, server.API_SECRET_KEY is not None)"
        )
        proc = subprocess.run(
            [sys.executable, '-c', code],
            cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), '..')),
            env={**os.environ, **env},
            capture_output=True,
            text=True,
        )
        return proc

    def test_production_refuses_to_boot_without_key(self):
        """production بلا WHATSAPP_API_KEY: لا يقلع، ويشرح السبب."""
        proc = self._boot({'WHATSAPP_ENV': 'production', 'WHATSAPP_API_KEY': ''})
        self.assertNotEqual(proc.returncode, 0)
        self.assertNotIn('BOOTED', proc.stdout)
        self.assertIn('WHATSAPP_API_KEY', proc.stderr)

    def test_production_refuses_a_guessable_key(self):
        """مفتاح أقصر من الحد الأدنى يُرفض كما لو كان غائباً."""
        proc = self._boot({'WHATSAPP_ENV': 'production', 'WHATSAPP_API_KEY': 'hader123'})
        self.assertNotEqual(proc.returncode, 0)
        self.assertNotIn('BOOTED', proc.stdout)

    def test_production_boots_with_a_real_key(self):
        """مفتاح بالطول المطلوب يُقلع الخادم ويفعّل المصادقة."""
        proc = self._boot({'WHATSAPP_ENV': 'production', 'WHATSAPP_API_KEY': 'a' * 64})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn('BOOTED production True', proc.stdout)

    def test_development_still_boots_without_a_key(self):
        """التشغيل المحلي لم يتغير: بلا مفتاح وبلا رفض."""
        proc = self._boot({'WHATSAPP_ENV': 'development', 'WHATSAPP_API_KEY': ''})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn('BOOTED development False', proc.stdout)


class TestApiKeyRejection(unittest.TestCase):
    """الطلبات المرفوضة عندما يكون المفتاح مضبوطاً."""

    KEY = 'k' * 64

    def setUp(self):
        self.app = server.app.test_client()
        server.API_SECRET_KEY = self.KEY
        sqlite_db.init_db()

    def tearDown(self):
        server.API_SECRET_KEY = None

    def test_no_key_is_rejected(self):
        for path in ('/api/status', '/api/queue', '/api/stats', '/api/qr', '/api/schedule'):
            with self.subTest(path=path):
                self.assertEqual(self.app.get(path).status_code, 401)

    def test_wrong_key_is_rejected(self):
        for path in ('/api/status', '/api/queue'):
            with self.subTest(path=path):
                res = self.app.get(path, headers={'X-API-Key': 'w' * 64})
                self.assertEqual(res.status_code, 401)

    def test_key_of_right_length_but_wrong_value_is_rejected(self):
        """مفتاح بنفس الطول لكنه خاطئ: المقارنة ثابتة الزمن ولا تسرّب الطول."""
        res = self.app.get('/api/status', headers={'X-API-Key': 'k' * 63 + 'x'})
        self.assertEqual(res.status_code, 401)

    def test_sending_control_is_rejected_without_key(self):
        """نقاط التحكم في الإرسال محمية أيضاً، لا القراءة فقط."""
        for path in ('/api/start', '/api/sending/start', '/api/sending/stop', '/api/stop',
                     '/api/schedule', '/api/schedule/run'):
            with self.subTest(path=path):
                self.assertEqual(self.app.post(path).status_code, 401)

    def test_send_endpoint_is_rejected_without_key(self):
        res = self.app.post('/api/send', json=[{'phone': '966500000000', 'message': 'x'}])
        self.assertEqual(res.status_code, 401)

    def test_correct_key_passes(self):
        res = self.app.get('/api/status', headers={'X-API-Key': self.KEY})
        self.assertEqual(res.status_code, 200)


class TestEngineAutostart(unittest.TestCase):
    """استعادة الاتصال عند إقلاع الخدمة، منفصلة تماماً عن تشغيل الإرسال."""

    def test_autostart_opens_the_browser_without_sending(self):
        """الاستعادة تستدعي start_engine بـ auto_send=False، ولا تطلب إرسالاً."""
        with patch.object(server, 'AUTO_START_ENGINE', True), \
             patch.object(server, 'AUTO_START_DELAY_SECONDS', 0), \
             patch.object(server.engine, 'start_engine', return_value=(True, 'ok', 202)) as start, \
             patch.object(server.engine, 'start_sending') as start_sending, \
             patch.object(type(server.engine), 'alive', new_callable=lambda: property(lambda self: False)):
            server._schedule_engine_autostart()
            for _ in range(50):
                if start.called:
                    break
                time.sleep(0.02)

        start.assert_called_once_with(auto_send=False)
        start_sending.assert_not_called()

    def test_autostart_is_skipped_when_disabled(self):
        """على سطح المكتب يبقى القرار للمستخدم: لا استعادة تلقائية."""
        with patch.object(server, 'AUTO_START_ENGINE', False), \
             patch.object(server.engine, 'start_engine') as start:
            server._schedule_engine_autostart()
            time.sleep(0.1)
        start.assert_not_called()

    def test_autostart_does_not_disturb_a_running_engine(self):
        """محرك يعمل أصلاً لا يُعاد تشغيله."""
        with patch.object(server, 'AUTO_START_ENGINE', True), \
             patch.object(server, 'AUTO_START_DELAY_SECONDS', 0), \
             patch.object(server.engine, 'start_engine') as start, \
             patch.object(type(server.engine), 'alive', new_callable=lambda: property(lambda self: True)):
            server._schedule_engine_autostart()
            time.sleep(0.15)
        start.assert_not_called()

    def test_autostart_defaults_to_container_mode_only(self):
        """الافتراضي مربوط بوضع الحاوية، لا مفعّل للجميع."""
        self.assertEqual(server.AUTO_START_ENGINE, server.VPS_MODE)


class TestDriverIsNotDownloadedAtRuntime(unittest.TestCase):
    """داخل الحاوية: لا تنزيل chromedriver عند التشغيل — الصورة تحمله."""

    def test_vps_mode_refuses_to_reach_for_webdriver_manager(self):
        import whatsapp_pro_tool as tool

        bot = tool.WhatsAppProTool.__new__(tool.WhatsAppProTool)
        bot.driver = None
        bot.wait = None
        bot.on_event = None
        bot.last_activity_time = 0.0

        with patch.object(tool, '_VPS_MODE', True), \
             patch.object(tool.os.path, 'exists', return_value=False), \
             patch.dict(tool.os.environ, {'CHROMEDRIVER_PATH': ''}, clear=False), \
             patch.object(tool, 'ChromeDriverManager') as manager, \
             patch.object(tool.WhatsAppProTool, '_cleanup_session_locks', lambda self: None), \
             patch.object(tool.WhatsAppProTool, '_build_chrome_options', lambda self: object()), \
             patch.object(tool.os, 'makedirs', lambda *a, **k: None), \
             patch.object(tool.time, 'sleep', lambda *_: None):
            ok = bot.init_browser()

        self.assertFalse(ok, "بلا driver داخل الحاوية يجب أن يفشل التشغيل صراحةً")
        manager.assert_not_called()

    def test_desktop_still_falls_back_to_webdriver_manager(self):
        """على سطح المكتب يبقى التنزيل التلقائي — هناك لا توجد صورة تحمل الـ driver."""
        import whatsapp_pro_tool as tool

        bot = tool.WhatsAppProTool.__new__(tool.WhatsAppProTool)
        bot.driver = None
        bot.wait = None
        bot.on_event = None
        bot.last_activity_time = 0.0

        with patch.object(tool, '_VPS_MODE', False), \
             patch.object(tool, 'PLATFORM', 'Darwin'), \
             patch.dict(tool.os.environ, {'CHROMEDRIVER_PATH': ''}, clear=False), \
             patch.object(tool, 'ChromeDriverManager') as manager, \
             patch.object(tool, 'Service') as service, \
             patch.object(tool.webdriver, 'Chrome', side_effect=RuntimeError('no browser here')), \
             patch.object(tool.WhatsAppProTool, '_cleanup_session_locks', lambda self: None), \
             patch.object(tool.WhatsAppProTool, '_build_chrome_options', lambda self: object()), \
             patch.object(tool.os, 'makedirs', lambda *a, **k: None), \
             patch.object(tool.time, 'sleep', lambda *_: None):
            bot.init_browser()

        self.assertTrue(manager.called or service.called)


class TestHealthEndpoint(unittest.TestCase):
    """فحص الحياة يعمل بلا مفتاح، ولا يكشف حالة الجلسة."""

    def setUp(self):
        self.app = server.app.test_client()
        server.API_SECRET_KEY = 'h' * 64

    def tearDown(self):
        server.API_SECRET_KEY = None

    def test_health_is_reachable_without_a_key(self):
        res = self.app.get('/api/health')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()['ok'])

    def test_health_says_nothing_about_the_session_or_the_queue(self):
        body = self.app.get('/api/health').get_json()
        for leak in ('logged_in', 'state', 'pending', 'queue', 'logs', 'progress'):
            self.assertNotIn(leak, body)

    def test_status_is_still_protected(self):
        self.assertEqual(self.app.get('/api/status').status_code, 401)
