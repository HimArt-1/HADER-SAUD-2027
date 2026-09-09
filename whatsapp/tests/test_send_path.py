"""
Tests for the compose/send path of whatsapp_pro_tool, with a fake driver (no Selenium session).

Regression guarded here: the tool used to press ENTER and record a successful send even when
the message never reached the editor, so the operator saw the chat open, nothing typed and
nothing sent — while the dashboard reported "sent".

Run:  python3 -m unittest whatsapp/tests/test_send_path.py -v
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import whatsapp_pro_tool as wpt  # noqa: E402
from whatsapp_pro_tool import WhatsAppProTool  # noqa: E402


class FakeElement:
    """
    Stands in for the WhatsApp composer.

    ``accepts`` names the insertion mechanisms this editor honours, so a test can model an
    editor that silently ignores key events (what modern WhatsApp Web does to some synthetic
    input) while still accepting an insertText command.
    """

    def __init__(self, accepts=('keys', 'insert')):
        self.accepts = set(accepts)
        self.text = ''
        self.clicks = 0
        self.keys_log = []

    def click(self):
        self.clicks += 1

    def send_keys(self, value):
        self.keys_log.append(value)
        if value == wpt.Keys.ENTER:
            return
        if value == wpt.Keys.BACKSPACE:
            if 'keys' in self.accepts:
                self.text = self.text[:-1]
            return
        if 'keys' in self.accepts:
            self.text += str(value)


class FakeActionChains:
    """
    Records the chords the tool builds without touching a real driver, and models the one
    chord that changes the editor: SHIFT+ENTER inserts a newline instead of submitting.
    """

    performed = []

    def __init__(self, driver):
        self._pending = []
        self._driver = driver

    def key_down(self, key):
        self._pending.append(('down', key))
        return self

    def key_up(self, key):
        self._pending.append(('up', key))
        return self

    def send_keys(self, keys):
        self._pending.append(('keys', keys))
        return self

    def perform(self):
        chord = list(self._pending)
        FakeActionChains.performed.append(chord)
        self._pending = []

        element = getattr(self._driver, 'element', None)
        if element is None or 'keys' not in element.accepts:
            return
        if ('down', wpt.Keys.SHIFT) in chord and ('keys', wpt.Keys.ENTER) in chord:
            element.text += '\n'
        elif ('keys', wpt.Keys.BACKSPACE) in chord:
            element.text = ''          # the clear chord is select-all then backspace


class FakeDriver:
    def __init__(self, element, send_button=None):
        self.element = element
        self.send_button = send_button
        self.scripts = []

    def execute_script(self, script, *args):
        self.scripts.append(script)
        if 'innerText' in script:
            return args[0].text if args else ''
        if 'insertText' in script:
            target, text = args[0], args[1]
            if 'insert' in target.accepts:
                target.text = text
            return None
        if 'click' in script:
            return None
        return None

    def find_elements(self, by, value):
        return []


class FakeSendButton:
    def __init__(self, element, empties=True):
        self.element = element
        self.empties = empties
        self.clicks = 0

    def click(self):
        self.clicks += 1
        if self.empties:
            self.element.text = ''


def make_tool(element, send_button=None):
    tool = WhatsAppProTool(db_path=':memory:')
    tool.driver = FakeDriver(element, send_button)
    return tool


class ComposeMessageTest(unittest.TestCase):
    def setUp(self):
        FakeActionChains.performed.clear()
        patcher_ac = mock.patch.object(wpt, 'ActionChains', FakeActionChains)
        patcher_sleep = mock.patch.object(wpt.time, 'sleep', lambda *_: None)
        patcher_ac.start(); patcher_sleep.start()
        self.addCleanup(patcher_ac.stop); self.addCleanup(patcher_sleep.stop)

    def test_accepts_the_message_typed_by_the_human_strategy(self):
        element = FakeElement(accepts=('keys',))
        tool = make_tool(element)
        self.assertTrue(tool._compose_message(element, 'مرحبا بك'))
        self.assertEqual(element.text, 'مرحبا بك')
        # The first strategy sufficed, so insertText was never needed.
        self.assertFalse(any('insertText' in s for s in tool.driver.scripts))

    def test_falls_back_to_insert_text_when_the_editor_ignores_key_events(self):
        element = FakeElement(accepts=('insert',))   # Lexical-style editor dropping synthetic keys
        tool = make_tool(element)
        self.assertTrue(tool._compose_message(element, 'رسالة الاختبار'))
        self.assertEqual(element.text, 'رسالة الاختبار')
        self.assertTrue(any('insertText' in s for s in tool.driver.scripts))

    def test_reports_failure_when_no_strategy_lands_the_text(self):
        element = FakeElement(accepts=())            # nothing works
        tool = make_tool(element)
        self.assertFalse(tool._compose_message(element, 'لن تصل'))
        self.assertEqual(element.text, '')

    def test_long_messages_are_composed_too(self):
        element = FakeElement(accepts=('keys',))
        tool = make_tool(element)
        long_message = 'س' * 400
        self.assertTrue(tool._compose_message(element, long_message))
        self.assertEqual(element.text, long_message)

    def test_newlines_use_shift_enter_so_the_message_is_not_submitted_early(self):
        element = FakeElement(accepts=('keys',))
        tool = make_tool(element)
        self.assertTrue(tool._compose_message(element, 'سطر أول\nسطر ثانٍ'))
        self.assertEqual(element.text, 'سطر أول\nسطر ثانٍ')

        shift_enter = [c for c in FakeActionChains.performed
                       if ('down', wpt.Keys.SHIFT) in c and ('keys', wpt.Keys.ENTER) in c]
        self.assertTrue(shift_enter, 'newline must be typed as SHIFT+ENTER')
        self.assertNotIn(wpt.Keys.ENTER, element.keys_log, 'a bare ENTER would send half a message')

    def test_whitespace_differences_do_not_count_as_failure(self):
        element = FakeElement(accepts=('keys',))
        tool = make_tool(element)
        self.assertTrue(tool._compose_message(element, 'كلمة   بمسافات'))


class PressSendTest(unittest.TestCase):
    def setUp(self):
        FakeActionChains.performed.clear()
        patcher_ac = mock.patch.object(wpt, 'ActionChains', FakeActionChains)
        patcher_sleep = mock.patch.object(wpt.time, 'sleep', lambda *_: None)
        patcher_ac.start(); patcher_sleep.start()
        self.addCleanup(patcher_ac.stop); self.addCleanup(patcher_sleep.stop)

    def test_refuses_to_send_an_empty_composer(self):
        element = FakeElement()
        tool = make_tool(element)
        self.assertFalse(tool._press_send(element))

    def test_clicks_the_send_button_and_confirms_the_composer_emptied(self):
        element = FakeElement(); element.text = 'جاهزة'
        button = FakeSendButton(element, empties=True)
        tool = make_tool(element)
        with mock.patch.object(wpt, '_find_first', return_value=button):
            self.assertTrue(tool._press_send(element))
        self.assertEqual(button.clicks, 1)
        self.assertEqual(element.text, '')

    def test_falls_back_to_enter_when_no_send_button_exists(self):
        element = FakeElement(); element.text = 'جاهزة'

        class EnterSendsElement(FakeElement):
            def send_keys(self, value):
                super().send_keys(value)
                if value == wpt.Keys.ENTER:
                    self.text = ''

        element = EnterSendsElement(); element.text = 'جاهزة'
        tool = make_tool(element)
        with mock.patch.object(wpt, '_find_first', return_value=None):
            self.assertTrue(tool._press_send(element))
        self.assertIn(wpt.Keys.ENTER, element.keys_log)

    def test_reports_failure_when_the_message_stays_in_the_composer(self):
        element = FakeElement(); element.text = 'عالقة'
        button = FakeSendButton(element, empties=False)
        tool = make_tool(element)
        with mock.patch.object(wpt, '_find_first', return_value=button), \
             mock.patch.object(wpt.time, 'time', side_effect=[0, 1, 99, 99, 99]):
            self.assertFalse(tool._press_send(element))
        self.assertEqual(element.text, 'عالقة')


class SendSingleMessageTest(unittest.TestCase):
    """The row status must reflect what actually happened, never an optimistic 'sent'."""

    def setUp(self):
        FakeActionChains.performed.clear()
        patcher_ac = mock.patch.object(wpt, 'ActionChains', FakeActionChains)
        patcher_sleep = mock.patch.object(wpt.time, 'sleep', lambda *_: None)
        patcher_ac.start(); patcher_sleep.start()
        self.addCleanup(patcher_ac.stop); self.addCleanup(patcher_sleep.stop)

    def _tool(self, element):
        tool = make_tool(element)
        tool.statuses = {}
        tool._update_status = lambda msg_id, status: tool.statuses.__setitem__(msg_id, status)
        tool._open_chat = lambda phone: True
        tool._simulate_human_activity = lambda: None
        tool._reading_pause = lambda: None
        return tool

    def test_marks_failed_when_the_message_never_reaches_the_composer(self):
        element = FakeElement(accepts=())
        tool = self._tool(element)
        row = {'id': 'row-1', 'phone': '0501234567', 'message': 'اختبار'}

        with mock.patch.object(wpt, '_find_first', return_value=element):
            outcome = tool._send_single_message(row, 1, 1)

        self.assertEqual(outcome, 'failed')
        self.assertEqual(tool.statuses['row-1'], 'failed')
        self.assertEqual(tool.stats['sent'], 0)
        self.assertEqual(tool.stats['failed'], 1)

    def test_marks_failed_when_the_composed_message_is_never_sent(self):
        element = FakeElement(accepts=('keys',))
        tool = self._tool(element)
        row = {'id': 'row-2', 'phone': '0501234567', 'message': 'اختبار'}

        with mock.patch.object(wpt, '_find_first', return_value=element), \
             mock.patch.object(tool, '_press_send', return_value=False):
            outcome = tool._send_single_message(row, 1, 1)

        self.assertEqual(outcome, 'failed')
        self.assertEqual(tool.statuses['row-2'], 'failed')
        self.assertEqual(tool.stats['sent'], 0)

    def test_marks_sent_only_after_compose_and_send_both_succeed(self):
        element = FakeElement(accepts=('keys',))
        tool = self._tool(element)
        row = {'id': 'row-3', 'phone': '0501234567', 'message': 'اختبار'}

        with mock.patch.object(wpt, '_find_first', return_value=element), \
             mock.patch.object(tool, '_press_send', return_value=True):
            outcome = tool._send_single_message(row, 1, 1)

        self.assertEqual(outcome, 'sent')
        self.assertEqual(tool.statuses['row-3'], 'sent')
        self.assertEqual(tool.stats['sent'], 1)
        self.assertEqual(tool.stats['failed'], 0)


class FakeRow:
    """A search-result row as WhatsApp renders it."""

    def __init__(self, text='', title=None, aria=None):
        self.text = text
        self._attrs = {'title': title, 'aria-label': aria}
        self.clicks = 0

    def get_attribute(self, name):
        return self._attrs.get(name)

    def click(self):
        self.clicks += 1


class UnsavedNumberTest(unittest.TestCase):
    """
    An unsaved number is printed formatted ("+966 50 123 4567"), so matching the raw digits
    as a substring never fired. The old code then fell through to "click the first row",
    which either opened somebody else's chat or nothing at all.
    """

    def setUp(self):
        self.tool = make_tool(FakeElement())

    def test_recognises_an_unsaved_number_shown_in_formatted_style(self):
        row = FakeRow(text='+966 50 123 4567')
        self.assertTrue(self.tool._row_matches_phone(row, '966501234567'))

    def test_recognises_the_number_when_it_only_appears_in_the_title(self):
        row = FakeRow(text='رسالة جديدة', title='‪+966 50 123 4567‬')
        self.assertTrue(self.tool._row_matches_phone(row, '966501234567'))

    def test_matches_a_saved_contact_row_carrying_the_number(self):
        row = FakeRow(text='أبو أحمد', aria='966501234567')
        self.assertTrue(self.tool._row_matches_phone(row, '966501234567'))

    def test_matches_a_row_rendered_with_arabic_indic_numerals(self):
        row = FakeRow(text='‪+٩٦٦ ٥٠ ١٢٣ ٤٥٦٧‬')
        self.assertTrue(self.tool._row_matches_phone(row, '966501234567'))

    def test_refuses_an_unrelated_row_so_nobody_else_is_messaged(self):
        self.assertFalse(self.tool._row_matches_phone(FakeRow(text='مجموعة الصف الأول'), '966501234567'))
        self.assertFalse(self.tool._row_matches_phone(FakeRow(text='+966 55 999 8877'), '966501234567'))
        self.assertFalse(self.tool._row_matches_phone(FakeRow(text=''), '966501234567'))

    def test_survives_a_row_that_went_stale(self):
        class StaleRow(FakeRow):
            @property
            def text(self):
                raise wpt.StaleElementReferenceException('gone')

            @text.setter
            def text(self, _value):
                pass

        self.assertFalse(self.tool._row_matches_phone(StaleRow(), '966501234567'))


class OpenChatRoutingTest(unittest.TestCase):
    """The send link is the route that works for a number missing from the address book."""

    def setUp(self):
        patcher_sleep = mock.patch.object(wpt.time, 'sleep', lambda *_: None)
        patcher_sleep.start()
        self.addCleanup(patcher_sleep.stop)

        self.element = FakeElement()
        self.tool = make_tool(self.element)
        self.navigations = []
        self.tool.driver.get = lambda url: self.navigations.append(url)

    def test_uses_the_send_link_when_the_number_is_not_in_the_contacts(self):
        self.tool._open_chat_via_search = lambda phone: False
        with mock.patch.object(wpt.WebDriverWait, 'until', lambda *_a, **_k: True), \
             mock.patch.object(wpt, '_find_first', return_value=self.element):
            self.assertTrue(self.tool._open_chat('966501234567'))

        self.assertEqual(self.navigations, ['https://web.whatsapp.com/send?phone=966501234567'])

    def test_keeps_the_search_result_and_never_reloads_when_it_matched(self):
        self.tool._open_chat_via_search = lambda phone: True
        self.assertTrue(self.tool._open_chat('966501234567'))
        self.assertEqual(self.navigations, [], 'a matched search must not reload the page')

    def test_reports_failure_when_the_link_never_opens_a_composer(self):
        self.tool._open_chat_via_search = lambda phone: False
        with mock.patch.object(wpt.WebDriverWait, 'until', lambda *_a, **_k: True), \
             mock.patch.object(wpt, '_find_first', return_value=None):
            self.assertFalse(self.tool._open_chat('966501234567'))


class InvalidPopupSelectorTest(unittest.TestCase):
    def test_selectors_are_scoped_to_dialogs_not_the_whole_document(self):
        # A bare //*[contains(text(),"invalid")] matched stray text anywhere on the page and
        # skipped every message as an unreachable number.
        for xpath in wpt._SELECTORS['invalid_popup']:
            self.assertFalse(
                xpath.startswith('//*['),
                f'selector must be scoped to a container, got {xpath}'
            )


if __name__ == '__main__':
    unittest.main()
