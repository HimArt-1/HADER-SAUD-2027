"""
Delivery safety: pacing between messages, attachments, emoji, element lookups and the queue rules
that decide what may be retried. Fakes only — no browser, no WhatsApp session, and the real
contacts.db is never written.

Run:  python3 -m unittest whatsapp/tests/test_delivery_safety.py -v
"""
import os
import sys
import tempfile
import time as real_time
import unittest
import uuid
from datetime import datetime, timedelta
from unittest import mock

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(TESTS_DIR))
sys.path.insert(0, TESTS_DIR)

import sqlite_db  # noqa: E402
import whatsapp_pro_tool as wpt  # noqa: E402
from whatsapp_pro_tool import WhatsAppProTool  # noqa: E402
from test_send_path import FakeActionChains, FakeElement, make_tool, use_fake_clock  # noqa: E402


class PacingTest(unittest.TestCase):
    """
    The gap between messages and the long break must hold however rows reach the queue. Rows queued
    while earlier ones were going out used to leave with no wait, and the batch counter restarted on
    every queue read, so notices trickling in never reached a long break.
    """

    MIN, MAX, BREAK = 10, 20, 90      # uniform() is pinned to its midpoint: 15s gaps, 90s breaks

    def setUp(self):
        self.clock = use_fake_clock(self)
        patcher = mock.patch.object(wpt.random, 'uniform', lambda a, b: (a + b) / 2)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.tool = WhatsAppProTool(db_path=':memory:')
        self.tool.refresh_threshold = 10 ** 6
        self.tool._reset_stuck_rows = lambda: None
        self.tool._update_status = lambda *_: None
        self.breaks = []
        self.tool._idle_browsing = lambda: self.breaks.append(self.clock.now)
        self.sent_at = {}

        def send(row, current, total):
            self.sent_at[row['id']] = self.clock.now
            return row.get('outcome', 'sent')

        self.tool._send_single_message = send

    def run_mission(self, *reads, batch_size=8):
        reads = [list(read) for read in reads]
        self.tool._pending_rows = lambda: reads.pop(0) if reads else []
        return self.tool.run_mission(batch_size=batch_size, min_delay=self.MIN, max_delay=self.MAX,
                                     long_break=self.BREAK, warmup=(0, 0))

    def offsets(self):
        start = min(self.sent_at.values())
        return {row_id: at - start for row_id, at in self.sent_at.items()}

    def test_rows_queued_while_sending_still_wait_their_gap(self):
        self.run_mission([{'id': 'a'}], [{'id': 'b'}, {'id': 'c'}])
        self.assertEqual(self.offsets(), {'a': 0, 'b': 15, 'c': 30})

    def test_the_long_break_counts_messages_across_queue_reads(self):
        self.run_mission([{'id': 'a'}, {'id': 'b'}], [{'id': 'c'}, {'id': 'd'}], [{'id': 'e'}], batch_size=3)
        self.assertEqual(self.offsets(), {'a': 0, 'b': 15, 'c': 30, 'd': 120, 'e': 135})
        self.assertEqual(len(self.breaks), 1, 'idle browsing belongs to the one long break')

    def test_rows_that_never_reach_whatsapp_cost_no_gap(self):
        self.run_mission([{'id': 'bad', 'outcome': 'skipped'}, {'id': 'a'}, {'id': 'b'}])
        self.assertEqual(self.offsets(), {'bad': 0, 'a': 0, 'b': 15})

    def test_failed_and_unconfirmed_rows_still_count_as_contact_with_whatsapp(self):
        self.run_mission([{'id': 'a', 'outcome': 'failed'}, {'id': 'b', 'outcome': 'unconfirmed'}, {'id': 'c'}])
        self.assertEqual(self.offsets(), {'a': 0, 'b': 15, 'c': 30})

    def test_restarting_the_mission_does_not_skip_the_gap(self):
        self.run_mission([{'id': 'a'}])
        self.run_mission([{'id': 'b'}])
        self.assertEqual(self.offsets(), {'a': 0, 'b': 15})

    def test_a_queue_that_sat_empty_longer_than_the_gap_sends_at_once(self):
        self.run_mission([{'id': 'a'}])
        self.clock.now += 600
        self.run_mission([{'id': 'b'}])
        self.assertEqual(self.offsets(), {'a': 0, 'b': 600})
        self.assertEqual(self.breaks, [])

    def test_a_long_wait_keeps_the_watchdog_from_seeing_a_frozen_browser(self):
        self.tool.sending = True
        self.tool.last_activity_time = self.clock.now
        self.assertTrue(self.tool._sleep(600))
        self.assertGreaterEqual(self.tool.last_activity_time, self.clock.now - 1)


class FindFirstTest(unittest.TestCase):
    """A selector WhatsApp no longer renders used to cost its whole timeout on every message."""

    def test_a_missing_preferred_selector_costs_no_waiting(self):
        wanted = object()
        driver = mock.Mock()
        driver.find_elements.side_effect = lambda by, xpath: [wanted] if xpath == '//second' else []
        started = real_time.monotonic()
        with mock.patch.object(wpt, 'WebDriverWait', side_effect=AssertionError('no wait was needed')):
            self.assertIs(wpt._find_first(driver, ['//first', '//second'], timeout=10), wanted)
        self.assertLess(real_time.monotonic() - started, 1)

    def test_keeps_the_order_of_preference_when_several_selectors_match(self):
        preferred, other = object(), object()
        driver = mock.Mock()
        driver.find_elements.side_effect = lambda by, xpath: {'//first': [preferred], '//second': [other]}[xpath]
        self.assertIs(wpt._find_first(driver, ['//first', '//second'], timeout=5), preferred)

    def test_one_wait_covers_every_selector_until_any_of_them_appears(self):
        late = object()
        arrived = {'yes': False}

        def find_elements(by, xpath):
            if xpath == '//first | //second':
                arrived['yes'] = True
                return [late]
            return [late] if arrived['yes'] and xpath == '//second' else []

        driver = mock.Mock()
        driver.find_elements.side_effect = find_elements
        waits = []
        real_wait = wpt.WebDriverWait
        with mock.patch.object(wpt, 'WebDriverWait', side_effect=lambda *a, **k: waits.append(a) or real_wait(*a, **k)):
            self.assertIs(wpt._find_first(driver, ['//first', '//second'], timeout=5), late)
        self.assertEqual(len(waits), 1)

    def test_gives_up_when_nothing_appears_in_time(self):
        driver = mock.Mock()
        driver.find_elements.return_value = []
        with mock.patch.object(wpt.WebDriverWait, 'until', side_effect=wpt.TimeoutException()):
            self.assertIsNone(wpt._find_first(driver, ['//first', '//second'], timeout=2))

    def test_a_closed_window_is_not_mistaken_for_a_missing_element(self):
        driver = mock.Mock()
        driver.find_elements.side_effect = wpt.NoSuchWindowException('closed')
        with self.assertRaises(wpt.NoSuchWindowException):
            wpt._find_first(driver, ['//first'], timeout=1)


class EmojiComposeTest(unittest.TestCase):
    """ChromeDriver cannot type characters outside the BMP, which covers most emoji."""

    def setUp(self):
        FakeActionChains.performed.clear()
        for target, name, fake in ((wpt, 'ActionChains', FakeActionChains), (wpt.time, 'sleep', lambda *_: None)):
            patcher = mock.patch.object(target, name, fake)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_messages_with_emoji_go_straight_to_insert_text(self):
        element = FakeElement(accepts=('keys', 'insert'))
        tool = make_tool(element)
        self.assertTrue(tool._compose_message(element, 'أهلاً بكم 🌟'))
        self.assertEqual(element.text, 'أهلاً بكم 🌟')
        self.assertEqual(element.keys_log, [], 'no character may be typed key by key')
        self.assertFalse(any(('keys', wpt.Keys.BACKSPACE) in chord for chord in FakeActionChains.performed),
                         'nothing half-typed should need clearing')

    def test_plain_text_is_still_typed_like_a_person(self):
        element = FakeElement(accepts=('keys', 'insert'))
        tool = make_tool(element)
        self.assertTrue(tool._compose_message(element, 'أهلاً بكم'))
        self.assertTrue(element.keys_log)
        self.assertFalse(any('insertText' in script for script in tool.driver.scripts))


class PreviewSendButton:
    """The preview's send button: a click closes the preview, which takes the button off the page."""

    def __init__(self, closes=True):
        self.closes = closes
        self.clicks = 0
        self.gone = False

    def click(self):
        self.clicks += 1
        self.gone = self.closes

    def is_displayed(self):
        if self.gone:
            raise wpt.StaleElementReferenceException('removed with the preview')
        return True


class AttachmentPage:
    """Answers the tool's element lookups the way WhatsApp's attachment flow would."""

    def __init__(self, composer, *, attach=True, caption=True, preview_closes=True):
        self.composer = composer
        self.attach_btn = mock.Mock() if attach else None
        self.file_input = mock.Mock()
        self.caption_box = FakeElement(accepts=('keys',)) if caption else None
        self.send_btn = PreviewSendButton(closes=preview_closes)
        self.preview_open = False

    def find_first(self, driver, selectors, timeout=0):
        selectors = list(selectors)
        if selectors == wpt._SELECTORS['invalid_popup']:
            return None
        if selectors == wpt._SELECTORS['attach_btn']:
            return self.attach_btn
        if selectors == wpt._SELECTORS['file_input']:
            self.preview_open = True
            return self.file_input
        if selectors == wpt._SELECTORS['caption_box']:
            return self.caption_box if self.preview_open else None
        if selectors == wpt._SELECTORS['send_btn']:
            return None if self.send_btn.gone else self.send_btn
        return self.composer


class AttachmentTest(unittest.TestCase):
    """A barcode card used to count as sent even when the file never left."""

    MESSAGE = 'بطاقة الطالب أحمد'

    def setUp(self):
        FakeActionChains.performed.clear()
        patcher = mock.patch.object(wpt, 'ActionChains', FakeActionChains)
        patcher.start()
        self.addCleanup(patcher.stop)
        use_fake_clock(self)
        handle, self.card = tempfile.mkstemp(suffix='.png')
        os.close(handle)
        self.addCleanup(os.remove, self.card)

    def send(self, page, press_send=wpt.SEND_SENT):
        tool = make_tool(page.composer)
        tool.history = []
        tool._update_status = lambda msg_id, status: tool.history.append(status)
        tool._open_chat = lambda phone: True
        tool._simulate_human_activity = lambda: None
        tool._reading_pause = lambda: None
        row = {'id': 'card', 'phone': '0501234567', 'message': self.MESSAGE, 'attachment': self.card}
        with mock.patch.object(wpt, '_find_first', page.find_first), \
             mock.patch.object(tool, '_press_send', return_value=press_send) as pressed:
            outcome = tool._send_single_message(row, 1, 1)
        return outcome, tool, pressed

    def test_the_message_rides_as_the_caption_in_one_send(self):
        page = AttachmentPage(FakeElement(accepts=('keys',)))
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'sent')
        self.assertEqual(page.caption_box.text, self.MESSAGE)
        self.assertEqual(page.send_btn.clicks, 1)
        page.file_input.send_keys.assert_called_once_with(os.path.abspath(self.card))
        pressed.assert_not_called()                   # no second, text-only message
        self.assertEqual(page.composer.keys_log, [])
        self.assertEqual(tool.history, ['sending', 'confirming', 'sent'])

    def test_without_a_caption_box_the_text_follows_the_file(self):
        page = AttachmentPage(FakeElement(accepts=('keys',)), caption=False)
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'sent')
        self.assertEqual(page.send_btn.clicks, 1)
        pressed.assert_called_once()
        self.assertEqual(page.composer.text, self.MESSAGE)

    def test_a_file_that_never_attached_fails_the_row_before_any_text(self):
        page = AttachmentPage(FakeElement(accepts=('keys',)), attach=False)
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'failed')
        self.assertEqual(tool.history[-1], 'failed')
        pressed.assert_not_called()
        self.assertEqual(page.composer.keys_log, [])

    def test_a_preview_that_never_closes_means_the_file_did_not_leave(self):
        page = AttachmentPage(FakeElement(accepts=('keys',)), preview_closes=False)
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'failed')
        pressed.assert_not_called()

    def test_text_lost_after_the_file_went_alone_is_left_for_review(self):
        page = AttachmentPage(FakeElement(accepts=()), caption=False)   # the chat composer takes nothing
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'unconfirmed')
        pressed.assert_not_called()

    def test_a_missing_file_skips_the_row_without_opening_a_chat(self):
        page = AttachmentPage(FakeElement(accepts=('keys',)))
        tool = make_tool(page.composer)
        tool._update_status = lambda *_: None
        tool._open_chat = lambda phone: self.fail('a row without its file must not open a chat')
        gone = os.path.join(os.path.dirname(self.card), f'gone-{uuid.uuid4().hex}.png')
        row = {'id': 'card', 'phone': '0501234567', 'message': self.MESSAGE, 'attachment': gone}
        self.assertEqual(tool._send_single_message(row, 1, 1), 'skipped')


class QueueRulesTest(unittest.TestCase):
    """Retry, dedupe and crash recovery, against a scratch database."""

    def setUp(self):
        handle, path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        self.addCleanup(lambda: [os.remove(p) for p in (path, path + '-wal', path + '-shm') if os.path.exists(p)])
        patcher = mock.patch.object(sqlite_db, 'DB_FILE', path)
        patcher.start()
        self.addCleanup(patcher.stop)
        sqlite_db.init_db()

    def add(self, row_id, status='pending', retry_count=0, created_at=None):
        self.assertEqual(sqlite_db.append_to_queue([{
            'id': row_id, 'phone': '966501234567', 'message': 'رسالة', 'status': status,
            'retry_count': retry_count, 'created_at': created_at or datetime.now().isoformat(),
        }]), 1)

    @staticmethod
    def ids(rows):
        return [row['id'] for row in rows]

    def test_an_id_already_in_the_queue_is_ignored(self):
        notice = {'id': 'absent:s1:2026-09-15', 'phone': '966501234567', 'message': 'غياب'}
        self.assertEqual(sqlite_db.append_to_queue([notice]), 1)
        self.assertEqual(sqlite_db.append_to_queue([notice, {**notice, 'id': 'absent:s2:2026-09-15'}]), 1)
        self.assertEqual(sorted(self.ids(sqlite_db.get_queue())), ['absent:s1:2026-09-15', 'absent:s2:2026-09-15'])

    def test_failed_rows_get_one_retry_after_the_fresh_rows(self):
        self.add('failed-once', status='failed', retry_count=1)
        self.add('fresh')
        self.add('failed-twice', status='failed', retry_count=2)
        self.assertEqual(self.ids(sqlite_db.get_pending_with_retry()), ['fresh', 'failed-once'])

    def test_a_second_failure_uses_up_the_retry(self):
        self.add('row')
        sqlite_db.update_status('row', 'failed')
        self.assertEqual(self.ids(sqlite_db.get_pending_with_retry()), ['row'])
        sqlite_db.update_status('row', 'failed')
        self.assertEqual(sqlite_db.get_pending_with_retry(), [])

    def test_rows_that_may_already_be_delivered_are_never_picked_up(self):
        for status in ('unconfirmed', 'sent', 'invalid_phone', 'skipped', 'sending', 'confirming'):
            self.add(status, status=status)
        self.assertEqual(sqlite_db.get_pending_with_retry(), [])

    def test_an_old_failure_is_not_sent_the_next_day(self):
        stale = (datetime.now() - timedelta(hours=sqlite_db.RETRY_WINDOW_HOURS + 1)).isoformat()
        self.add('yesterday', status='failed', retry_count=1, created_at=stale)
        self.assertEqual(sqlite_db.get_pending_with_retry(), [])

    def test_crash_recovery_requeues_unpressed_rows_and_flags_pressed_ones(self):
        self.add('typing', status='sending')
        self.add('pressed', status='confirming')
        self.assertEqual(sqlite_db.reset_stuck_sending(), 2)
        statuses = {row['id']: row['status'] for row in sqlite_db.get_queue()}
        self.assertEqual(statuses, {'typing': 'pending', 'pressed': 'unconfirmed'})

    def test_stats_report_rows_waiting_for_review(self):
        self.add('review', status='unconfirmed')
        self.add('leaving', status='confirming')
        stats = sqlite_db.get_stats()
        self.assertEqual((stats['unconfirmed'], stats['pending']), (1, 1))
        self.assertEqual(sqlite_db.count_pending(), 1)

    def test_the_engine_reads_its_work_through_the_retry_rules(self):
        self.add('failed-once', status='failed', retry_count=1)
        self.add('fresh')
        self.add('review', status='unconfirmed')
        tool = WhatsAppProTool(db_path=sqlite_db.DB_FILE)
        self.assertEqual(self.ids(tool._pending_rows()), ['fresh', 'failed-once'])


if __name__ == '__main__':
    unittest.main()
