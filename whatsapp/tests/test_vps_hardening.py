import os
import sys
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
