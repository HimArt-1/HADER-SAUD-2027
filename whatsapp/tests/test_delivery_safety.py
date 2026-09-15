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

    def __init__(self, composer, *, attach=True, caption=True, preview_closes=True, file_accepted=True,
                 send_button=True, discard_pending=False):
        self.composer = composer
        self.attach_btn = mock.Mock() if attach else None
        self.file_accepted = file_accepted
        self.send_button = send_button
        self.discard_pending = discard_pending      # a discard question left on screen by an earlier row
        self.discards = 0
        self.discard_btn = mock.Mock()
        self.discard_btn.click.side_effect = self._discard
        self.caption_box = FakeElement(accepts=('keys',)) if caption else None
        self.send_btn = PreviewSendButton(closes=preview_closes)
        self.preview_open = False

    def _discard(self):
        self.discards += 1
        self.discard_pending = False
        self.preview_open = False

    def _escaped_open_preview(self):
        # Escape on an open preview makes WhatsApp ask whether to discard it.
        return self.preview_open and any(('keys', wpt.Keys.ESCAPE) in chord for chord in FakeActionChains.performed)

    def find_first(self, driver, selectors, timeout=0):
        selectors = list(selectors)
        if selectors == wpt._SELECTORS['invalid_popup']:
            return None
        if selectors == wpt._SELECTORS['attach_btn']:
            return self.attach_btn
        if selectors == wpt._SELECTORS['caption_box']:
            return self.caption_box if self.preview_open else None
        if selectors == wpt._SELECTORS['send_btn']:
            return None if (self.send_btn.gone or not self.send_button) else self.send_btn
        if selectors == wpt._SELECTORS['discard_confirm']:
            return self.discard_btn if (self.discard_pending or self._escaped_open_preview()) else None
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
        self.chosen = []

        def choose(path):
            self.chosen.append(path)
            self.discard_pending_at_choose = page.discard_pending
            page.preview_open = page.file_accepted
            return page.file_accepted

        tool._choose_file = choose
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
        self.assertEqual(self.chosen, [self.card])
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

    def test_a_file_the_menu_would_not_take_fails_the_row_before_any_text(self):
        page = AttachmentPage(FakeElement(accepts=('keys',)), file_accepted=False)
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'failed')
        self.assertEqual(page.send_btn.clicks, 0)
        pressed.assert_not_called()
        self.assertEqual(page.composer.keys_log, [])

    def test_giving_up_on_a_preview_answers_the_discard_question(self):
        # Escape alone left «هل تريد تجاهل الاختيار؟» on screen, and it blocked the next row's clicks.
        page = AttachmentPage(FakeElement(accepts=('keys',)), send_button=False)
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'failed')
        self.assertEqual(page.discards, 1)
        self.assertFalse(page.preview_open)
        pressed.assert_not_called()

    def test_a_discard_question_left_on_screen_is_answered_before_the_row_starts(self):
        page = AttachmentPage(FakeElement(accepts=('keys',)), discard_pending=True)
        outcome, tool, pressed = self.send(page)
        self.assertEqual(outcome, 'sent')
        self.assertEqual(page.discards, 1)
        self.assertFalse(self.discard_pending_at_choose, 'the question must be gone before attaching')

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


class FilePickerDriver:
    """WhatsApp's 2026 attach menu: each entry creates a file input on the spot and clicks it."""

    def __init__(self, *, entries=('media', 'document'), asks_for_file=True):
        self.entries = set(entries)
        self.asks_for_file = asks_for_file
        self.armed = False
        self.captured = False
        self.opened = []
        self.cdp = []
        self.page_input = mock.Mock()

    def _entry(self, kind):
        entry = mock.Mock()

        def click():
            self.opened.append(kind)
            self.captured = self.armed and self.asks_for_file

        entry.click.side_effect = click
        return entry

    def find_elements(self, by, xpath):
        if 'menuitem' in xpath:
            kind = 'media' if ('الصور' in xpath or 'Photos' in xpath) else 'document'
            return [self._entry(kind)] if kind in self.entries else []
        if 'type="file"' in xpath:
            return [self.page_input]
        return []

    def execute_script(self, script, *args):
        if '__haderCaptureFiles = true' in script:
            self.armed = True
        elif '__haderCaptureFiles = false' in script:
            self.armed = False
        elif '__haderFileInput' in script:
            return self.captured
        return True

    def execute_cdp_cmd(self, command, params):
        self.cdp.append((command, params))
        return {'result': {'objectId': 'input-1'}} if command == 'Runtime.evaluate' else {}


class FileChoiceTest(unittest.TestCase):
    """
    The 2026 attach menu creates its file input only when an entry is clicked, and clicking that
    input would open the operating system's file dialog.
    """

    def setUp(self):
        use_fake_clock(self)
        self.image = os.path.join(tempfile.gettempdir(), 'card.png')
        self.pdf = os.path.join(tempfile.gettempdir(), 'report.pdf')

    @staticmethod
    def choose(driver, path):
        tool = make_tool(FakeElement())
        tool.driver = driver
        return tool._choose_file(path)

    def test_an_image_goes_to_the_photos_entry_and_arrives_through_devtools(self):
        driver = FilePickerDriver()
        self.assertTrue(self.choose(driver, self.image))
        self.assertEqual(driver.opened, ['media'])
        self.assertIn(('DOM.setFileInputFiles', {'files': [os.path.abspath(self.image)], 'objectId': 'input-1'}), driver.cdp)
        self.assertFalse(driver.armed, 'file inputs must behave normally again afterwards')
        driver.page_input.send_keys.assert_not_called()

    def test_the_os_file_dialog_is_held_back_while_choosing(self):
        driver = FilePickerDriver()
        self.choose(driver, self.image)
        switches = [params['enabled'] for command, params in driver.cdp if command == 'Page.setInterceptFileChooserDialog']
        self.assertEqual(switches, [True, False])

    def test_a_pdf_goes_to_the_document_entry(self):
        driver = FilePickerDriver()
        self.assertTrue(self.choose(driver, self.pdf))
        self.assertEqual(driver.opened, ['document'])

    def test_a_menu_that_never_asks_for_the_file_attaches_nothing(self):
        # The input already in the page may belong to another entry — a new sticker, for one.
        driver = FilePickerDriver(asks_for_file=False)
        self.assertFalse(self.choose(driver, self.image))
        driver.page_input.send_keys.assert_not_called()
        self.assertFalse(any(command == 'DOM.setFileInputFiles' for command, _ in driver.cdp))
        self.assertFalse(driver.armed)

    def test_builds_without_the_menu_fill_the_input_in_the_page(self):
        driver = FilePickerDriver(entries=())
        with mock.patch.object(wpt.WebDriverWait, 'until', side_effect=wpt.TimeoutException()):
            self.assertTrue(self.choose(driver, self.image))
        driver.page_input.send_keys.assert_called_once_with(os.path.abspath(self.image))


class NewChatSearchTest(unittest.TestCase):
    """The chat list's search box is always on screen; the number belongs in the new-chat drawer."""

    def setUp(self):
        FakeActionChains.performed.clear()
        patcher = mock.patch.object(wpt, 'ActionChains', FakeActionChains)
        patcher.start()
        self.addCleanup(patcher.stop)
        use_fake_clock(self)
        self.side = FakeElement(accepts=('keys',))
        self.drawer = FakeElement(accepts=('keys',))
        self.new_chat = mock.Mock()

    def tool(self, drawer_opens=True):
        tool = make_tool(FakeElement())

        def find_elements(by, xpath):
            if 'دردشة جديدة' in xpath:
                return [self.new_chat]
            if 'not(ancestor' in xpath:
                return [self.drawer] if drawer_opens else []
            if '@id="side"' in xpath and 'input' in xpath:
                return [self.side]
            return []

        tool.driver.find_elements = find_elements
        tool._await_matching_row = lambda phone, timeout=9: None
        return tool

    def test_types_the_number_into_the_new_chat_drawer(self):
        self.assertFalse(self.tool()._open_chat_via_search('966501234567'))   # no row matches in this fake
        self.new_chat.click.assert_called_once()
        self.assertEqual(self.drawer.text, '966501234567')
        self.assertEqual(self.side.text, '')

    def test_falls_back_to_the_chat_list_search_when_no_drawer_opens(self):
        with mock.patch.object(wpt.WebDriverWait, 'until', side_effect=wpt.TimeoutException()):
            self.tool(drawer_opens=False)._open_chat_via_search('966501234567')
        self.assertEqual(self.side.text, '966501234567')
        self.assertEqual(self.drawer.text, '')


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
