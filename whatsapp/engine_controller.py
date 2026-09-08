"""
Engine Controller — lifecycle state machine for the WhatsApp engine
====================================================================
Owns the single background thread that drives the Selenium bot and exposes
thread-safe commands for the HTTP layer.  Selenium is *never* imported here
so the controller can be unit-tested with a fake bot.

Two-phase flow (what the dashboard buttons map to)
──────────────────────────────────────────────────
  "تشغيل المحرك"  → start_engine()   : open Chrome + WhatsApp Web, wait for
                                         login, then park in the ``ready`` state.
  "إبدأ الإرسال"  → start_sending()  : bring the WhatsApp window to the front
                                         and dispatch the pending queue.

States
──────
  idle           nothing running
  initializing   Chrome is starting
  waiting_login  WhatsApp Web is open, waiting for QR scan / session restore
  ready          logged in, window open, NOT sending (armed)
  sending        mission running
  paused         mission paused (window stays open)
  error          last run failed (window closed)
  stopped        stopped by the user (window closed)

Bot contract (duck-typed, see WhatsAppProTool)
──────────────────────────────────────────────
  init_browser() -> bool
  open_whatsapp() -> bool
  wait_for_login(timeout, should_continue) -> bool
  is_logged_in() -> bool
  bring_to_front() -> bool
  run_mission(**options)          blocking until queue drained / stopped
  pause() / resume() / stop_sending() / request_focus() / close()
  attributes: sending, paused, last_activity_time, stats, progress, on_event
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Any, Callable, Dict, Optional, Tuple

ENGINE_ALIVE_STATES = frozenset({'initializing', 'waiting_login', 'ready', 'sending', 'paused'})
SENDING_STATES = frozenset({'sending', 'paused'})

DEFAULT_MISSION_OPTIONS: Dict[str, Any] = {
    'batch_size': 8,
    'min_delay': 10,
    'max_delay': 25,
    'long_break': 90,
    'continuous': False,
}

_MISSION_OPTION_TYPES: Dict[str, Callable[[Any], Any]] = {
    'batch_size': int,
    'min_delay': float,
    'max_delay': float,
    'long_break': float,
    'continuous': bool,
}

_MISSION_OPTION_BOUNDS: Dict[str, Tuple[float, float]] = {
    'batch_size': (1, 100),
    'min_delay': (1, 600),
    'max_delay': (1, 900),
    'long_break': (0, 3600),
}

# Arabic labels shown by the dashboard for every state.
STATE_LABELS: Dict[str, str] = {
    'idle': 'في وضع الانتظار',
    'initializing': 'جاري تهيئة المتصفح...',
    'waiting_login': 'تم فتح واتساب ويب - بانتظار تسجيل الدخول (مسح رمز QR)',
    'ready': 'المحرك جاهز - اضغط "إبدأ الإرسال" لإرسال الطابور',
    'sending': 'جاري إرسال الرسائل...',
    'paused': 'الإرسال متوقف مؤقتاً',
    'error': 'حدث خطأ',
    'stopped': 'تم إيقاف المحرك',
}


def sanitize_mission_options(raw: Optional[Dict[str, Any]], defaults: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Merge user-supplied mission options over the defaults, coercing types and clamping ranges."""
    options = dict(DEFAULT_MISSION_OPTIONS)
    if defaults:
        options.update(defaults)
    if isinstance(raw, dict):
        for key, caster in _MISSION_OPTION_TYPES.items():
            if key not in raw or raw[key] is None:
                continue
            try:
                value = caster(raw[key])
            except (TypeError, ValueError):
                continue
            bounds = _MISSION_OPTION_BOUNDS.get(key)
            if bounds:
                value = max(bounds[0], min(bounds[1], value))
            options[key] = value
    if options['max_delay'] < options['min_delay']:
        options['max_delay'] = options['min_delay']
    return options


class EngineController:
    """Thread-safe owner of the bot lifecycle."""

    def __init__(
        self,
        bot_factory: Callable[[], Any],
        *,
        on_change: Optional[Callable[[Dict[str, Any]], None]] = None,
        login_timeout: float = 15 * 60,
        idle_poll_interval: float = 1.0,
        heartbeat_interval: float = 15.0,
        mission_defaults: Optional[Dict[str, Any]] = None,
        clock: Callable[[], float] = time.time,
    ):
        self._bot_factory = bot_factory
        self._on_change = on_change
        self._login_timeout = login_timeout
        self._idle_poll_interval = idle_poll_interval
        self._heartbeat_interval = heartbeat_interval
        self._mission_defaults = dict(mission_defaults or {})
        self._clock = clock

        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._bot: Any = None
        self._commands: "queue.Queue[Tuple[str, Any]]" = queue.Queue()
        self._stop_event = threading.Event()
        self._run_id = 0

        self.state = 'idle'
        self.message = STATE_LABELS['idle']
        self.logged_in = False
        self.last_error: Optional[str] = None
        self.started_at: Optional[float] = None
        self.last_state_change: float = self._clock()
        self.progress: Dict[str, Any] = self._empty_progress()
        self.last_result: Optional[Dict[str, Any]] = None

    # ── Snapshot ───────────────────────────────────────────────────

    @staticmethod
    def _empty_progress() -> Dict[str, Any]:
        return {'current': 0, 'total': 0, 'sent': 0, 'failed': 0, 'skipped': 0,
                'last_phone': '', 'last_name': ''}

    @property
    def alive(self) -> bool:
        return self.state in ENGINE_ALIVE_STATES

    @property
    def sending(self) -> bool:
        return self.state == 'sending'

    @property
    def paused(self) -> bool:
        return self.state == 'paused'

    @property
    def bot(self) -> Any:
        with self._lock:
            return self._bot

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            bot = self._bot
            last_activity = getattr(bot, 'last_activity_time', None) if bot else None
            return {
                'running': self.alive,
                'state': self.state,
                'state_message': self.message,
                'logged_in': bool(self.logged_in),
                'sending': self.state in SENDING_STATES,
                'paused': self.state == 'paused',
                'progress': dict(self.progress),
                'last_error': self.last_error,
                'started_at': self.started_at,
                'last_activity': last_activity,
                'last_result': dict(self.last_result) if self.last_result else None,
            }

    # ── State helpers ──────────────────────────────────────────────

    def _set(self, state: str, message: Optional[str] = None, *, error: Optional[str] = None) -> None:
        with self._lock:
            self.state = state
            self.message = message or STATE_LABELS.get(state, state)
            self.last_state_change = self._clock()
            if state == 'error':
                self.last_error = error or self.message
            if state not in ENGINE_ALIVE_STATES:
                self.logged_in = False
        logging.info(f"🧭 Engine state → {state}: {self.message}")
        self._notify()

    def _notify(self) -> None:
        if not self._on_change:
            return
        try:
            self._on_change(self.snapshot())
        except Exception as exc:  # pragma: no cover - observers must never break the engine
            logging.warning(f"Engine observer failed: {exc}")

    def _handle_bot_event(self, event: str, payload: Dict[str, Any]) -> None:
        """Progress callback wired into the bot (called from the bot thread)."""
        if event == 'progress':
            with self._lock:
                self.progress.update({k: payload.get(k, self.progress.get(k)) for k in self.progress})
                if self.state in SENDING_STATES:
                    current, total = self.progress['current'], self.progress['total']
                    who = self.progress.get('last_name') or self.progress.get('last_phone') or ''
                    prefix = 'الإرسال متوقف مؤقتاً' if self.state == 'paused' else 'جاري الإرسال'
                    self.message = f"{prefix} {current}/{total}" + (f" → {who}" if who else '')
            self._notify()
        elif event == 'waiting':
            with self._lock:
                if self.state == 'sending':
                    self.message = payload.get('message') or 'بانتظار رسائل جديدة في الطابور...'
            self._notify()
        elif event == 'session_lost':
            with self._lock:
                self.logged_in = False
            self._notify()

    # ── Public commands (called from HTTP threads) ─────────────────

    def start_engine(self, *, auto_send: bool = False, options: Optional[Dict[str, Any]] = None) -> Tuple[bool, str, int]:
        """Open Chrome + WhatsApp Web and wait for login. Never sends unless auto_send."""
        with self._lock:
            if self.alive:
                return False, 'المحرك يعمل بالفعل', 409
            if self._thread and self._thread.is_alive():
                return False, 'المحرك قيد الإيقاف - حاول بعد لحظات', 409
            self._stop_event.clear()
            self._drain_commands()
            self._run_id += 1
            self.progress = self._empty_progress()
            self.last_error = None
            self.last_result = None
            self.started_at = self._clock()
            self.logged_in = False
            mission = sanitize_mission_options(options, self._mission_defaults)
            self.state = 'initializing'
            self.message = STATE_LABELS['initializing']
            self._thread = threading.Thread(
                target=self._run, args=(self._run_id, auto_send, mission),
                name=f'whatsapp-engine-{self._run_id}', daemon=True,
            )
            self._thread.start()
        self._notify()
        return True, 'تم بدء تشغيل المحرك - سيتم فتح واتساب ويب الآن', 202

    def start_sending(self, options: Optional[Dict[str, Any]] = None) -> Tuple[bool, str, int]:
        """Bring the WhatsApp window to the front and dispatch the pending queue."""
        with self._lock:
            if not self.alive:
                return False, 'شغّل المحرك أولاً ثم ابدأ الإرسال', 409
            if self.state == 'initializing':
                return False, 'المتصفح ما زال قيد التهيئة - انتظر لحظات', 409
            if self.state == 'waiting_login':
                return False, 'امسح رمز QR في نافذة واتساب ويب أولاً', 409
            if self.state == 'paused':
                return self._resume_locked()
            if self.state == 'sending':
                return False, 'الإرسال جارٍ بالفعل', 409
            mission = sanitize_mission_options(options, self._mission_defaults)
            self._commands.put(('send', mission))
        return True, 'تم فتح نافذة واتساب - بدأ الإرسال', 202

    def pause_sending(self) -> Tuple[bool, str, int]:
        with self._lock:
            if self.state != 'sending':
                return False, 'لا يوجد إرسال جارٍ لإيقافه مؤقتاً', 409
            bot = self._bot
            if bot is not None:
                bot.pause()
            self.state = 'paused'
            self.message = STATE_LABELS['paused']
            self.last_state_change = self._clock()
        self._notify()
        return True, 'تم إيقاف الإرسال مؤقتاً', 200

    def resume_sending(self) -> Tuple[bool, str, int]:
        with self._lock:
            return self._resume_locked()

    def _resume_locked(self) -> Tuple[bool, str, int]:
        if self.state != 'paused':
            return False, 'الإرسال ليس متوقفاً مؤقتاً', 409
        bot = self._bot
        if bot is not None:
            bot.request_focus()
            bot.resume()
        self.state = 'sending'
        self.message = STATE_LABELS['sending']
        self.last_state_change = self._clock()
        self._notify()
        return True, 'تم استكمال الإرسال', 200

    def stop_sending(self) -> Tuple[bool, str, int]:
        """Stop the mission but keep the WhatsApp window open (back to ready)."""
        with self._lock:
            if self.state not in SENDING_STATES:
                return False, 'لا يوجد إرسال جارٍ', 409
            bot = self._bot
            if bot is not None:
                bot.resume()
                bot.stop_sending()
        return True, 'جاري إيقاف الإرسال - ستبقى نافذة واتساب مفتوحة', 202

    def focus_window(self) -> Tuple[bool, str, int]:
        """Bring the (last) WhatsApp Web window to the front."""
        with self._lock:
            if not self.alive or self.state == 'initializing':
                return False, 'لا توجد نافذة واتساب مفتوحة - شغّل المحرك أولاً', 409
            bot = self._bot
            if self.state in SENDING_STATES or self.state == 'waiting_login':
                # The engine thread is busy (mission loop / login wait): it services the flag itself.
                if bot is not None:
                    bot.request_focus()
            else:
                self._commands.put(('focus', None))
        return True, 'تم إظهار نافذة واتساب ويب', 202

    def stop_engine(self) -> Tuple[bool, str, int]:
        """Close the browser and stop everything."""
        with self._lock:
            thread = self._thread
            bot = self._bot
            was_alive = self.alive
            self._stop_event.set()
            if bot is not None:
                try:
                    bot.resume()
                    bot.stop_sending()
                except Exception:  # pragma: no cover - defensive
                    pass
            self._commands.put(('stop', None))
            if not was_alive and not (thread and thread.is_alive()):
                self.state = 'idle'
                self.message = STATE_LABELS['idle']
                self._notify()
                return False, 'المحرك متوقف بالفعل', 400
        return True, 'جاري إيقاف المحرك وإغلاق المتصفح...', 202

    def join(self, timeout: Optional[float] = None) -> None:
        thread = self._thread
        if thread:
            thread.join(timeout)

    def watchdog_check(self, max_idle_seconds: float = 300) -> bool:
        """Restart the engine when a mission has frozen. Returns True when a restart was triggered."""
        with self._lock:
            bot = self._bot
            if self.state != 'sending' or bot is None:
                return False
            last = getattr(bot, 'last_activity_time', None)
            if not last or (self._clock() - last) <= max_idle_seconds:
                return False
        logging.error(f"🚨 Watchdog: browser frozen for {int(self._clock() - last)}s - restarting engine")
        self._set('error', 'المتصفح لا يستجيب - جاري إعادة التشغيل تلقائياً...', error='watchdog')
        self.stop_engine()
        self.join(timeout=30)
        self.start_engine(auto_send=True)
        return True

    # ── Internals ──────────────────────────────────────────────────

    def _drain_commands(self) -> None:
        while True:
            try:
                self._commands.get_nowait()
            except queue.Empty:
                return

    def _should_continue(self) -> bool:
        return not self._stop_event.is_set()

    def _run(self, run_id: int, auto_send: bool, mission: Dict[str, Any]) -> None:
        bot = None
        try:
            bot = self._bot_factory()
            bot.on_event = self._handle_bot_event
            with self._lock:
                self._bot = bot
            self._set('initializing')

            if not bot.init_browser():
                self._set('error', 'فشل تهيئة المتصفح - تأكد من تثبيت Google Chrome', error='browser_init')
                return
            if not self._should_continue():
                return

            self._set('waiting_login')
            if not bot.open_whatsapp():
                self._set('error', 'تعذر فتح واتساب ويب - تحقق من اتصال الإنترنت', error='navigation')
                return

            if not bot.wait_for_login(timeout=self._login_timeout, should_continue=self._should_continue):
                if self._should_continue():
                    self._set('error', 'انتهت مهلة تسجيل الدخول - شغّل المحرك مجدداً وامسح رمز QR', error='login_timeout')
                return

            with self._lock:
                self.logged_in = True
            self._set('ready')

            if auto_send:
                self._commands.put(('send', mission))

            self._command_loop(bot)

        except Exception as exc:
            logging.error(f"💥 Engine thread crashed: {exc}", exc_info=True)
            self._set('error', f'خطأ في المحرك: {str(exc)[:120]}', error=str(exc))
        finally:
            if bot is not None:
                try:
                    bot.close()
                except Exception as close_err:  # pragma: no cover - defensive
                    logging.warning(f"Browser close failed: {close_err}")
            with self._lock:
                if self._run_id == run_id:
                    self._bot = None
                    self.logged_in = False
                    if self.state in ENGINE_ALIVE_STATES:
                        self.state = 'stopped'
                        self.message = STATE_LABELS['stopped']
                        self.last_state_change = self._clock()
            self._notify()

    def _command_loop(self, bot: Any) -> None:
        last_heartbeat = self._clock()
        while self._should_continue():
            try:
                command, payload = self._commands.get(timeout=self._idle_poll_interval)
            except queue.Empty:
                if (self._clock() - last_heartbeat) >= self._heartbeat_interval:
                    last_heartbeat = self._clock()
                    self._heartbeat(bot)
                continue

            if command == 'stop':
                return
            if command == 'focus':
                try:
                    bot.bring_to_front()
                except Exception as exc:
                    logging.warning(f"Focus failed: {exc}")
                continue
            if command == 'send':
                self._run_mission(bot, payload or {})
                last_heartbeat = self._clock()

    def _heartbeat(self, bot: Any) -> None:
        """While parked, make sure the session is still authenticated and the window still exists."""
        try:
            logged = bool(bot.is_logged_in())
        except Exception as exc:
            logging.warning(f"Heartbeat failed: {exc}")
            return
        with self._lock:
            state = self.state
        if logged and state == 'waiting_login':
            with self._lock:
                self.logged_in = True
            self._set('ready')
        elif not logged and state == 'ready':
            with self._lock:
                self.logged_in = False
            self._set('waiting_login', 'انتهت جلسة واتساب - امسح رمز QR مجدداً')

    def _run_mission(self, bot: Any, options: Dict[str, Any]) -> None:
        try:
            if not bot.is_logged_in():
                with self._lock:
                    self.logged_in = False
                self._set('waiting_login', 'انتهت جلسة واتساب - امسح رمز QR ثم اضغط "إبدأ الإرسال" مجدداً')
                return
        except Exception as exc:
            logging.warning(f"Login check failed before sending: {exc}")

        try:
            bot.bring_to_front()
        except Exception as exc:
            logging.warning(f"Could not bring WhatsApp window to front: {exc}")

        with self._lock:
            self.progress = self._empty_progress()
            self.logged_in = True
        self._set('sending')

        result: Dict[str, Any] = {}
        try:
            result = bot.run_mission(**options) or {}
        except Exception as exc:
            logging.error(f"💥 Mission crashed: {exc}", exc_info=True)
            result = {'error': str(exc)}

        if not self._should_continue():
            return

        with self._lock:
            self.last_result = result
            stats = getattr(bot, 'stats', {}) or {}
            sent = int(result.get('sent', stats.get('sent', 0)) or 0)
            failed = int(result.get('failed', stats.get('failed', 0)) or 0)
            skipped = int(result.get('skipped', stats.get('skipped', 0)) or 0)
            session_lost = bool(result.get('session_lost'))

        if session_lost:
            with self._lock:
                self.logged_in = False
            self._set('waiting_login', 'انتهت جلسة واتساب أثناء الإرسال - امسح رمز QR مجدداً')
            return

        summary = f"اكتمل الإرسال: {sent} نجحت، {failed} فشلت"
        if skipped:
            summary += f"، {skipped} تم تخطيها"
        if result.get('stopped'):
            summary = f"تم إيقاف الإرسال: {sent} نجحت، {failed} فشلت"
        self._set('ready', summary + ' - المحرك جاهز لإرسال جديد')
