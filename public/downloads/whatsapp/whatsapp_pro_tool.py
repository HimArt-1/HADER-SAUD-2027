"""
WhatsApp Pro Tool — Cross-Platform Automation Engine v5.0
=========================================================
• Supports macOS, Windows, and Linux
• Two-phase lifecycle: open WhatsApp Web + wait for login ("تشغيل المحرك"),
  then dispatch the queue on demand ("إبدأ الإرسال") — the browser stays open
  between missions so the operator never re-scans the QR code.
• Window focus: brings the (last) WhatsApp Web window to the front on
  every dispatch, cross-platform (macOS System Events, Win32, wmctrl/xdotool)
• Human-behaviour simulation (typing bursts, reading pauses, Bezier mouse, scroll)
• Load distribution: configurable batch_size, inter-message delays, batch breaks
• Pause / resume / stop that react within half a second
• Anti-detection: stealth fingerprints, CDP hiding
• Robust element detection: data-testid + legacy XPath fallbacks
• Thread-safe SQLite queue with status tracking & retry mechanism
• Automatic browser refresh to clear memory every N messages
"""

import os
import sys
import re
import json
import math
import platform
import subprocess
import tempfile
import threading
import time
import random
import logging
from datetime import datetime

import sqlite_db
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException, NoSuchWindowException,
    WebDriverException, StaleElementReferenceException
)
from webdriver_manager.chrome import ChromeDriverManager

# ─────────────────────────────────────────────────────────────────
# Paths & Platform
# ─────────────────────────────────────────────────────────────────
PLATFORM = platform.system()   # 'Darwin' | 'Windows' | 'Linux'
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
USER_DATA_DIR = os.path.join(BASE_DIR, "whatsapp_session")
WHATSAPP_URL = "https://web.whatsapp.com"

# Allowed directories for attachment security
ALLOWED_UPLOAD_DIRS = [
    os.path.abspath(os.path.join(BASE_DIR, 'uploads')),
    os.path.abspath(os.path.join(BASE_DIR, 'certificates')),
    tempfile.gettempdir(),          # /tmp on Mac/Linux, %TEMP% on Windows
]

# ─────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────
_log_dir = os.path.join(BASE_DIR, "logs")
os.makedirs(_log_dir, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(
            os.path.join(_log_dir, f"whatsapp_{datetime.now().strftime('%Y%m%d')}.log"),
            encoding='utf-8'
        ),
        logging.StreamHandler(sys.stdout),
    ]
)

# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────
def is_safe_path(file_path: str) -> bool:
    abs_path = os.path.abspath(file_path)
    return any(abs_path.startswith(d) for d in ALLOWED_UPLOAD_DIRS)


def validate_phone(phone: str) -> bool:
    arabic_map = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
    clean = str(phone).strip().translate(arabic_map)
    clean = clean.replace('+', '').replace(' ', '').replace('-', '')
    return bool(re.match(r'^\d{8,15}$', clean))


def _kill_chromedriver():
    """Kill stale chromedriver processes — cross-platform."""
    try:
        if PLATFORM == 'Windows':
            subprocess.run(
                ["taskkill", "/F", "/IM", "chromedriver.exe"],
                capture_output=True, timeout=5
            )
        else:
            subprocess.run(
                ["pkill", "-f", "chromedriver"],
                capture_output=True, timeout=5
            )
    except Exception:
        pass


def _child_pids(parent_pid: int) -> list:
    """Direct child process ids of ``parent_pid`` — cross-platform, no psutil needed."""
    if not parent_pid:
        return []
    try:
        if PLATFORM == 'Windows':
            import ctypes
            import ctypes.wintypes as wt

            TH32CS_SNAPPROCESS = 0x00000002

            class PROCESSENTRY32(ctypes.Structure):
                _fields_ = [
                    ('dwSize', wt.DWORD), ('cntUsage', wt.DWORD),
                    ('th32ProcessID', wt.DWORD), ('th32DefaultHeapID', ctypes.POINTER(ctypes.c_ulong)),
                    ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                    ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', ctypes.c_long),
                    ('dwFlags', wt.DWORD), ('szExeFile', ctypes.c_char * 260),
                ]

            kernel32 = ctypes.windll.kernel32
            snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            if snapshot == -1:
                return []
            entry = PROCESSENTRY32()
            entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
            children = []
            try:
                if kernel32.Process32First(snapshot, ctypes.byref(entry)):
                    while True:
                        if entry.th32ParentProcessID == parent_pid:
                            children.append(int(entry.th32ProcessID))
                        if not kernel32.Process32Next(snapshot, ctypes.byref(entry)):
                            break
            finally:
                kernel32.CloseHandle(snapshot)
            return children
        result = subprocess.run(['pgrep', '-P', str(parent_pid)], capture_output=True, text=True, timeout=3)
        return [int(p) for p in result.stdout.split() if p.strip().isdigit()]
    except Exception:
        return []


def _get_chrome_version() -> str:
    """Detect real Chrome version from the system."""
    try:
        if PLATFORM == 'Windows':
            import winreg
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Google\Chrome\BLBeacon')
            ver, _ = winreg.QueryValueEx(key, 'version')
            return ver
        elif PLATFORM == 'Darwin':
            result = subprocess.run(
                ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--version'],
                capture_output=True, text=True, timeout=5
            )
            match = re.search(r'(\d+\.\d+\.\d+\.\d+)', result.stdout)
            if match:
                return match.group(1)
        else:
            result = subprocess.run(
                ['google-chrome', '--version'],
                capture_output=True, text=True, timeout=5
            )
            match = re.search(r'(\d+\.\d+\.\d+\.\d+)', result.stdout)
            if match:
                return match.group(1)
    except Exception:
        pass
    return "126.0.6478.127"  # Reasonable recent fallback


def _get_user_agent() -> str:
    """Return a realistic UA string matching the current OS and real Chrome version."""
    chrome_ver = _get_chrome_version()
    if PLATFORM == 'Windows':
        return (
            f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            f"AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{chrome_ver} Safari/537.36"
        )
    elif PLATFORM == 'Darwin':
        return (
            f"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            f"AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{chrome_ver} Safari/537.36"
        )
    else:
        return (
            f"Mozilla/5.0 (X11; Linux x86_64) "
            f"AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{chrome_ver} Safari/537.36"
        )


# XPath / CSS selectors — prefer data-testid (stable), fall back to structural
_SELECTORS = {
    # WhatsApp Web ≥ 2023: conversation input box
    "input_box": [
        '//div[@data-testid="conversation-compose-box-input"]',
        '//div[@contenteditable="true"][@data-tab="10"]',
        '//footer//div[@contenteditable="true"]',
        '//div[contains(@class,"copyable-text")][@contenteditable="true"]',
    ],
    # Attach-button (paperclip icon)
    "attach_btn": [
        '//div[@data-testid="clip"]',
        '//button[@data-testid="clip"]',
        '//span[@data-icon="clip"]',
        '//span[@data-icon="plus"]',
    ],
    # File input inside attach panel
    "file_input": [
        '//input[@accept][contains(@accept,"image")][@type="file"]',
        '//input[@type="file"]',
    ],
    # Send button
    "send_btn": [
        '//button[@data-testid="send"]',
        '//span[@data-icon="send"]',
        '//div[@role="button"][@aria-label="Send"]',
        '//div[@role="button"][@aria-label="إرسال"]',
    ],
    # Side panel (login check — present when authenticated)
    "side_panel": [
        '//div[@id="side"]',
        '//div[@id="pane-side"]',
        '//div[@data-testid="chat-list"]',
        '//div[@aria-label="Chats"]',
        '//div[@aria-label="محادثات"]',
    ],
    # Invalid-number popup.
    # Scoped to the modal/alert containers on purpose: a bare //*[contains(text(),"invalid")]
    # matches any stray text node anywhere in WhatsApp Web's DOM, which made every message look
    # like an unreachable number and skipped it without ever typing.
    # Matching on the wording alone would break whenever WhatsApp rephrases the notice, so the
    # scope (a dialog or alert) carries the meaning and only a keyword is looked for inside it.
    "invalid_popup": [
        '//div[@role="dialog"][contains(., "invalid")]',
        '//div[@role="dialog"][contains(., "غير صحيح")]',
        '//div[@role="dialog"][contains(., "غير صالح")]',
        '//div[@role="alert"][contains(., "invalid")]',
        '//div[@role="alert"][contains(., "غير صحيح")]',
    ],
}

# Composer text is read back after typing to prove the message really landed in the editor.
_COMPOSER_TEXT_JS = "return (arguments[0].innerText || arguments[0].textContent || '').trim();"


def _find_first(driver, selectors: list, timeout: float = 0):
    """Try each XPath/CSS selector and return the first matching element, or None."""
    for xpath in selectors:
        try:
            if timeout > 0:
                wait = WebDriverWait(driver, timeout)
                return wait.until(EC.presence_of_element_located((By.XPATH, xpath)))
            else:
                elements = driver.find_elements(By.XPATH, xpath)
                if elements:
                    return elements[0]
        except (TimeoutException, NoSuchElementException):
            continue
    return None


# ─────────────────────────────────────────────────────────────────
# Core Tool
# ─────────────────────────────────────────────────────────────────
class WhatsAppProTool:
    """
    Professional WhatsApp bulk messaging tool.

    Lifecycle (driven by engine_controller.EngineController)
    ────────────────────────────────────────────────────────
    init_browser() → open_whatsapp() → wait_for_login()      "تشغيل المحرك"
    bring_to_front() → run_mission()                          "إبدأ الإرسال"
    pause() / resume() / stop_sending()                       queue controls
    close()                                                   "إيقاف اضطراري"

    Composing (every step is verified — a silent no-op is treated as a failure)
    ──────────────────────────────────────────────────────────────────────────
    • _compose_message – tries human typing, then direct keys, then insertText,
                         reading the editor back after each until the text is really there
    • _press_send      – send button first, ENTER as fallback, confirmed by the
                         composer emptying; otherwise the row is marked failed

    Human-simulation highlights
    ───────────────────────────
    • _type_like_human – character-level delays, word pauses, sentence rest, rare typo
    • _simulate_human_activity – random mouse micro-jitter + small scroll
    • _reading_pause  – variable delay before sending (simulates reading the draft)

    Load-distribution defaults (configurable via run_mission args)
    ─────────────────────────────────────────────────────────────
    batch_size  = 8   → send 8 messages, then take a long break
    min_delay   = 10s → minimum gap between two messages (within batch)
    max_delay   = 25s → maximum gap between two messages
    long_break  = 90s → base break length after each full batch (±20 % jitter)
    """

    SLEEP_TICK = 0.5   # granularity for pause / stop / focus responsiveness

    def __init__(self, db_path: str, file_lock=None, on_event=None):
        self.db_path   = db_path
        self.file_lock = file_lock
        self.on_event  = on_event          # callable(event: str, payload: dict)
        self.driver    = None
        self.wait      = None
        self.running   = False             # backward-compat alias of ``sending``
        self.sending   = False
        self.paused    = False
        self._focus_requested = threading.Event()
        self._pause_event = threading.Event()   # set → paused
        self.message_count = 0
        self.last_activity_time = time.time()
        # Refresh every 15–25 messages to prevent memory leaks
        self.refresh_threshold = random.randint(15, 25)
        self.stats = {"sent": 0, "failed": 0, "skipped": 0, "total": 0, "start_time": None}
        self.progress = {"current": 0, "total": 0, "sent": 0, "failed": 0, "skipped": 0,
                         "last_phone": "", "last_name": ""}

    # ── Lifecycle controls ─────────────────────────────────────────

    def stop(self):
        """Backward-compat: stop the current mission (browser stays open)."""
        self.stop_sending()

    def stop_sending(self):
        was_sending = self.sending
        self.running = False
        self.sending = False
        self._pause_event.clear()
        self.paused = False
        if was_sending:
            logging.info("⏹  Stop-sending signal received.")

    def pause(self):
        if self.sending:
            self.paused = True
            self._pause_event.set()
            logging.info("⏸  Sending paused.")

    def resume(self):
        if self.paused or self._pause_event.is_set():
            logging.info("▶️  Sending resumed.")
        self.paused = False
        self._pause_event.clear()

    def request_focus(self):
        """Ask the mission loop to bring the WhatsApp window to the front at the next safe point."""
        self._focus_requested.set()

    def close(self):
        """Quit the browser (idempotent)."""
        self.stop_sending()
        driver, self.driver = self.driver, None
        if driver is None:
            return
        try:
            driver.quit()
            logging.info("🔒 Browser closed safely.")
        except Exception as exc:
            logging.warning(f"Browser quit error (ignored): {exc}")

    def get_stats(self):
        """Get current statistics"""
        return {**self.stats}

    def _emit(self, event: str, payload: dict = None):
        callback = self.on_event
        if not callback:
            return
        try:
            callback(event, payload or {})
        except Exception as exc:
            logging.debug(f"on_event callback failed: {exc}")

    def _emit_progress(self):
        self._emit('progress', dict(self.progress))

    def _sleep(self, seconds: float) -> bool:
        """
        Interruptible sleep. Returns False when sending was stopped meanwhile.
        Honours pause (waits while paused) and focus requests.
        """
        deadline = time.time() + max(0.0, float(seconds))
        while True:
            if not self.sending:
                return False
            self._service_focus_request()
            if self._pause_event.is_set():
                # Paused: keep the watchdog happy and wait without consuming the delay budget.
                self.last_activity_time = time.time()
                time.sleep(self.SLEEP_TICK)
                deadline = max(deadline, time.time())
                continue
            remaining = deadline - time.time()
            if remaining <= 0:
                return True
            time.sleep(min(self.SLEEP_TICK, remaining))

    def _wait_if_paused(self) -> bool:
        """Block while paused. Returns False if sending was stopped."""
        while self._pause_event.is_set() and self.sending:
            self.last_activity_time = time.time()
            self._service_focus_request()
            time.sleep(self.SLEEP_TICK)
        return self.sending

    def _service_focus_request(self):
        if self._focus_requested.is_set():
            self._focus_requested.clear()
            try:
                self.bring_to_front()
            except Exception as exc:
                logging.debug(f"Focus request failed: {exc}")

    # ── Browser init ───────────────────────────────────────────────

    def _cleanup_session_locks(self):
        """Remove stale Chromium singleton lock files + kill zombie chromedrivers."""
        lock_files = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
        for lf in lock_files:
            path = os.path.join(USER_DATA_DIR, lf)
            if os.path.exists(path) or os.path.islink(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        _kill_chromedriver()

    def _build_chrome_options(self) -> Options:
        """Return hardened Chrome options for stealth + performance."""
        opts = Options()
        opts.add_argument(f"--user-data-dir={USER_DATA_DIR}")
        opts.add_argument("--profile-directory=Default")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_argument("--remote-debugging-port=0")
        opts.add_argument("--disable-infobars")
        opts.add_argument("--disable-notifications")
        # Prevent blank-page rendering on Chrome 130+ (macOS especially)
        opts.add_argument("--disable-features=VizDisplayCompositor")
        # Prevent Chrome initial dialogs from blocking page load
        opts.add_argument("--disable-search-engine-choice-screen")
        _w = 1280 + random.randint(-80, 80)
        _h = 900 + random.randint(-60, 60)
        opts.add_argument(f"--window-size={_w},{_h}")
        opts.add_argument("--disable-extensions")
        opts.add_argument("--disable-background-networking")
        opts.add_argument("--disable-sync")
        opts.add_argument("--disable-translate")
        opts.add_argument("--metrics-recording-only")
        opts.add_argument("--no-first-run")
        opts.add_argument(f"--user-agent={_get_user_agent()}")

        # Strip all automation fingerprints
        opts.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
        opts.add_experimental_option("useAutomationExtension", False)
        # Keep the browser alive if chromedriver dies; we quit it explicitly in close()
        opts.add_experimental_option("detach", False)

        return opts

    def _get_stealth_js(self) -> str:
        """Return lightweight stealth JS — avoids breaking WhatsApp Web internals."""
        return """
        // ═══════════════════════════════════════════════════════
        // 1. Hide navigator.webdriver
        // ═══════════════════════════════════════════════════════
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
        });

        // ═══════════════════════════════════════════════════════
        // 2. Languages
        // ═══════════════════════════════════════════════════════
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ar', 'ar-SA', 'en-US', 'en']
        });

        // ═══════════════════════════════════════════════════════
        // 3. Realistic window.chrome object
        // ═══════════════════════════════════════════════════════
        window.chrome = {
            app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
            runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' } }
        };

        // ═══════════════════════════════════════════════════════
        // 4. Permissions API — return realistic results
        // ═══════════════════════════════════════════════════════
        const origPermQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (params) =>
            params.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : origPermQuery.call(navigator.permissions, params);

        // ═══════════════════════════════════════════════════════
        // 5. Hardware concurrency & device memory
        // ═══════════════════════════════════════════════════════
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        if (navigator.deviceMemory !== undefined) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        }

        // ═══════════════════════════════════════════════════════
        // 6. Hide CDP (Chrome DevTools Protocol) indicators
        // ═══════════════════════════════════════════════════════
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        for (const key of Object.keys(window)) {
            if (/^cdc_/.test(key)) { delete window[key]; }
        }

        // NOTE: Canvas, WebGL, Plugins, and iframe overrides are
        // intentionally excluded — they break WhatsApp Web rendering.
        """

    def init_browser(self) -> bool:
        """Initialize browser with up to 3 retry attempts."""
        logging.info(f"🔧 Initialising engine on {PLATFORM}…")
        os.makedirs(USER_DATA_DIR, exist_ok=True)

        for attempt in range(1, 4):
            try:
                self._cleanup_session_locks()
                opts    = self._build_chrome_options()
                service = Service(ChromeDriverManager().install())
                self.driver = webdriver.Chrome(service=service, options=opts)

                # Inject comprehensive stealth fingerprints
                try:
                    self.driver.execute_cdp_cmd(
                        "Page.addScriptToEvaluateOnNewDocument",
                        {"source": self._get_stealth_js()}
                    )
                except Exception as cdp_err:
                    logging.warning(f"CDP stealth injection skipped (non-fatal): {cdp_err}")

                self.driver.set_page_load_timeout(60)
                self.wait = WebDriverWait(self.driver, 60)

                # Sanity check: load a blank page to verify the browser works
                try:
                    self.driver.get("about:blank")
                    time.sleep(1)
                except Exception as nav_err:
                    logging.warning(f"Initial navigation test failed: {nav_err}")

                self.last_activity_time = time.time()
                logging.info("✅ Engine ready.")
                return True

            except Exception as exc:
                logging.error(f"Attempt {attempt}/3 failed: {exc}")
                if self.driver:
                    try:
                        self.driver.quit()
                    except Exception:
                        pass
                    self.driver = None
                time.sleep(3 * attempt)

        return False

    # ── Window management ──────────────────────────────────────────

    def _whatsapp_handle(self):
        """
        Return (handle, all_handles) where handle is the LAST window that has
        WhatsApp Web loaded, or None when no such window exists.
        """
        if not self.driver:
            return None, []
        try:
            handles = list(self.driver.window_handles)
        except WebDriverException:
            return None, []
        current = None
        try:
            current = self.driver.current_window_handle
            # Fast path: the driver is already on a WhatsApp window — don't cycle through tabs.
            if 'web.whatsapp.com' in (self.driver.current_url or ''):
                return current, handles
        except WebDriverException:
            pass

        match = None
        for handle in handles:
            try:
                self.driver.switch_to.window(handle)
                if 'web.whatsapp.com' in (self.driver.current_url or ''):
                    match = handle          # keep the last match → "آخر نافذة منبثقة"
            except WebDriverException:
                continue

        if match is None and current in handles:
            try:
                self.driver.switch_to.window(current)
            except WebDriverException:
                pass
        return match, handles

    def open_whatsapp(self, timeout: float = 45) -> bool:
        """
        Make sure a window with WhatsApp Web exists and is selected.
        Re-uses the last WhatsApp window; opens a fresh one if the user closed it.
        """
        if not self.driver:
            return False
        try:
            handle, handles = self._whatsapp_handle()
            if handle is not None:
                self.driver.switch_to.window(handle)
                return True

            if not handles:
                self.driver.switch_to.new_window('window')
            else:
                self.driver.switch_to.window(handles[-1])

            logging.info("🌐 Opening WhatsApp Web…")
            try:
                self.driver.get(WHATSAPP_URL)
            except TimeoutException:
                logging.warning("⚠️ WhatsApp Web load timed out — continuing, elements may still appear.")

            try:
                WebDriverWait(self.driver, timeout).until(
                    lambda d: d.execute_script(
                        "return document.readyState === 'complete' "
                        "&& document.body && document.body.innerHTML.length > 100"
                    )
                )
                logging.info("📄 WhatsApp Web page loaded.")
            except TimeoutException:
                logging.warning("⚠️ Page load slow — continuing to wait for login elements…")
            except WebDriverException as js_err:
                logging.warning(f"⚠️ Page load check failed: {js_err}")
            self.last_activity_time = time.time()
            return True
        except WebDriverException as exc:
            logging.error(f"❌ Failed to open WhatsApp Web: {exc}")
            return False

    def is_logged_in(self) -> bool:
        """True when the chat side-panel is present in the WhatsApp window."""
        if not self.driver:
            return False
        try:
            handle, handles = self._whatsapp_handle()
            if handle is None:
                if not handles:
                    return False
                # The user navigated away / closed the tab — bring WhatsApp back.
                if not self.open_whatsapp():
                    return False
            for xpath in _SELECTORS["side_panel"]:
                if self.driver.find_elements(By.XPATH, xpath):
                    return True
            return False
        except (NoSuchWindowException, WebDriverException) as exc:
            logging.debug(f"Login probe failed: {exc}")
            return False

    def wait_for_login(self, timeout: float = None, should_continue=None, poll_interval: float = 2.0) -> bool:
        """
        Wait until the operator is authenticated (QR scanned or session restored).
        ``timeout`` None → wait forever (until should_continue() returns False).
        """
        logging.info("📱 Waiting for WhatsApp authentication (QR scan or saved session)…")
        deadline = None if timeout is None else time.time() + float(timeout)
        announced = False
        while True:
            if should_continue is not None and not should_continue():
                return False
            # "فتح نافذة واتساب" pressed while the QR code is on screen → raise the window now
            self._service_focus_request()
            if self.is_logged_in():
                logging.info("✅ Authenticated.")
                self.last_activity_time = time.time()
                return True
            if not announced:
                announced = True
                logging.info("🔎 QR code / login screen is up — scan it from your phone to continue.")
            self.last_activity_time = time.time()
            if deadline is not None and time.time() >= deadline:
                logging.warning("⏳ Login timeout — QR code was not scanned.")
                return False
            # Sleep in small ticks so focus requests and stop signals stay responsive
            slept = 0.0
            while slept < poll_interval:
                if should_continue is not None and not should_continue():
                    return False
                self._service_focus_request()
                time.sleep(self.SLEEP_TICK)
                slept += self.SLEEP_TICK

    def check_login(self, timeout: float = 90) -> bool:
        """Backward-compat helper: open WhatsApp Web and wait up to ``timeout`` s for login."""
        if not self.open_whatsapp():
            return False
        return self.wait_for_login(timeout=timeout)

    def bring_to_front(self) -> bool:
        """
        Bring the (last) WhatsApp Web window to the front of the screen —
        the visual confirmation the operator expects when pressing "إبدأ الإرسال".
        """
        if not self.driver:
            return False
        try:
            if not self.open_whatsapp():
                return False
            try:
                self.driver.execute_cdp_cmd('Page.bringToFront', {})
            except Exception as cdp_err:
                logging.debug(f"Page.bringToFront unavailable: {cdp_err}")
            try:
                self.driver.execute_script("window.focus();")
            except WebDriverException:
                pass
            self._os_activate_window()
            logging.info("🪟 WhatsApp Web window brought to front.")
            return True
        except WebDriverException as exc:
            logging.warning(f"Could not focus WhatsApp window: {exc}")
            return False

    def _browser_pids(self) -> list:
        """PIDs of the Chrome browser process(es) spawned by our chromedriver."""
        try:
            service = getattr(self.driver, 'service', None)
            process = getattr(service, 'process', None)
            pid = getattr(process, 'pid', None)
            return _child_pids(int(pid)) if pid else []
        except Exception:
            return []

    def _os_activate_window(self) -> bool:
        """OS-level activation so the window rises above other apps (best effort)."""
        try:
            if PLATFORM == 'Darwin':
                return self._activate_macos()
            if PLATFORM == 'Windows':
                return self._activate_windows()
            return self._activate_linux()
        except Exception as exc:
            logging.debug(f"OS activation skipped: {exc}")
            return False

    def _activate_macos(self) -> bool:
        for pid in self._browser_pids():
            script = (
                'tell application "System Events" to set frontmost of '
                f'(first process whose unix id is {pid}) to true'
            )
            result = subprocess.run(['osascript', '-e', script], capture_output=True, timeout=5)
            if result.returncode == 0:
                return True
        result = subprocess.run(
            ['osascript', '-e', 'tell application "Google Chrome" to activate'],
            capture_output=True, timeout=5
        )
        return result.returncode == 0

    def _activate_windows(self) -> bool:
        import ctypes
        import ctypes.wintypes as wt

        user32 = ctypes.windll.user32
        browser_pids = set(self._browser_pids())
        candidates = []

        EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

        def _callback(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            title = buffer.value or ''
            pid = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            owned = pid.value in browser_pids
            looks_like_whatsapp = 'WhatsApp' in title and 'Chrome' in title
            if owned or looks_like_whatsapp:
                candidates.append((owned, hwnd))
            return True

        user32.EnumWindows(EnumWindowsProc(_callback), 0)
        if not candidates:
            return False
        owned = [h for is_owned, h in candidates if is_owned]
        hwnd = (owned or [h for _, h in candidates])[-1]   # last window wins

        SW_RESTORE = 9
        VK_MENU = 0x12
        KEYEVENTF_KEYUP = 0x0002
        user32.ShowWindow(hwnd, SW_RESTORE)
        # Simulate an ALT tap so Windows allows SetForegroundWindow from a background process
        user32.keybd_event(VK_MENU, 0, 0, 0)
        user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
        user32.SetForegroundWindow(hwnd)
        user32.BringWindowToTop(hwnd)
        return True

    def _activate_linux(self) -> bool:
        title = ''
        try:
            title = self.driver.title or ''
        except WebDriverException:
            pass
        for command in (
            ['wmctrl', '-a', title or 'WhatsApp'],
            ['xdotool', 'search', '--name', 'WhatsApp', 'windowactivate', '--sync'],
        ):
            try:
                result = subprocess.run(command, capture_output=True, timeout=5)
                if result.returncode == 0:
                    return True
            except (FileNotFoundError, subprocess.SubprocessError):
                continue
        return False

    # ── Mission ────────────────────────────────────────────────────

    def run_mission(
        self,
        batch_size: int  = 8,
        min_delay:  float = 10,
        max_delay:  float = 25,
        long_break: float = 90,
        continuous: bool  = False,
        warmup: tuple     = (2, 5),
        respect_session_window: bool = False,
    ) -> dict:
        """
        Execute the messaging mission for everything pending in the queue.
        The browser is left open when the mission ends so a new mission can
        start immediately.

        Parameters
        ──────────
        batch_size  – send N messages, then take a long break
        min_delay   – minimum sleep between messages (seconds)
        max_delay   – maximum sleep between messages (seconds)
        long_break  – base long-break duration after a full batch (±20 %)
        continuous  – keep polling the queue for new items when empty
        warmup      – (min, max) seconds of "human warm-up" before the first message
        respect_session_window – pause during 01:00–06:00 (off by default)

        Returns a summary dict: sent / failed / skipped / stopped / session_lost.
        """
        logging.info(
            f"🚀 Mission start — batch_size={batch_size}, "
            f"delay={min_delay}–{max_delay}s, break={long_break}s, continuous={continuous}"
        )
        self.sending = True
        self.running = True
        self.paused = False
        self._pause_event.clear()
        self.stats = {"sent": 0, "failed": 0, "skipped": 0, "total": 0, "start_time": datetime.now().isoformat()}
        self.progress = {"current": 0, "total": 0, "sent": 0, "failed": 0, "skipped": 0,
                         "last_phone": "", "last_name": ""}
        self.last_activity_time = time.time()
        result = {"sent": 0, "failed": 0, "skipped": 0, "stopped": False, "session_lost": False}

        # Rows stuck in "sending" from a previous crash are re-queued.
        try:
            self._reset_stuck_rows()
        except Exception as exc:
            logging.debug(f"Could not reset stuck rows: {exc}")

        try:
            if respect_session_window and not self._is_within_session_window():
                logging.info("🌙 Outside session window — waiting for morning…")
                if not self._wait_for_session_window():
                    result["stopped"] = True
                    return self._finish_mission(result)

            # Short human warm-up before the first message
            warm_lo, warm_hi = (warmup or (0, 0))
            warm = random.uniform(float(warm_lo), float(warm_hi)) if warm_hi else 0
            if warm > 0:
                logging.info(f"🧘 Human warm-up: {warm:.1f}s before starting…")
                if not self._sleep(warm):
                    result["stopped"] = True
                    return self._finish_mission(result)

            idle_announced = False
            while self.sending:
                self.last_activity_time = time.time()
                if not self._wait_if_paused():
                    break

                pending = self._pending_rows()
                if not pending:
                    if continuous:
                        if not idle_announced:
                            idle_announced = True
                            self._emit('waiting', {"message": "الطابور فارغ - بانتظار رسائل جديدة..."})
                            logging.info("📭 Queue empty — waiting for new messages (continuous mode).")
                        if not self._sleep(5):
                            break
                        continue
                    logging.info("📭 Queue drained — mission complete.")
                    break
                idle_announced = False

                self.progress["total"] = self.progress["current"] + len(pending)
                logging.info(f"📨 {len(pending)} messages pending in queue.")

                for i, row in enumerate(pending):
                    if not self.sending:
                        break
                    if not self._wait_if_paused():
                        break
                    self._service_focus_request()

                    # Periodic browser refresh
                    if self.message_count > 0 and self.message_count % self.refresh_threshold == 0:
                        logging.info("🔄 Refreshing browser to maintain performance…")
                        try:
                            self.driver.refresh()
                            self._sleep(random.uniform(8, 15))
                            if not self.wait_for_login(timeout=60, should_continue=lambda: self.sending):
                                logging.error("❌ Session lost after refresh — stopping.")
                                result["session_lost"] = True
                                self.sending = False
                                break
                        except WebDriverException as refresh_err:
                            logging.error(f"Browser error after refresh: {refresh_err}")
                            result["session_lost"] = True
                            self.sending = False
                            break

                    self.last_activity_time = time.time()
                    self.progress["current"] += 1
                    self.progress["last_phone"] = str(row.get('phone', ''))
                    self.progress["last_name"] = str(row.get('student_name') or '')
                    self._emit_progress()

                    outcome = self._send_single_message(row, self.progress["current"], self.progress["total"])
                    self.message_count += 1
                    self.last_activity_time = time.time()
                    self.progress["sent"] = self.stats["sent"]
                    self.progress["failed"] = self.stats["failed"]
                    self.progress["skipped"] = self.stats["skipped"]
                    self._emit_progress()

                    if outcome == 'session_lost':
                        result["session_lost"] = True
                        self.sending = False
                        break

                    if respect_session_window and not self._is_within_session_window():
                        logging.info("🌙 Entering night hours — pausing until morning…")
                        if not self._wait_for_session_window():
                            break
                        logging.info("☀️ Morning — resuming mission.")
                        if not self._sleep(random.uniform(30, 90)):
                            break

                    # Batch break vs normal inter-message delay
                    is_last = (i + 1) >= len(pending)
                    if (i + 1) % batch_size == 0 and not is_last:
                        jitter     = random.uniform(0.8, 1.2)
                        sleep_time = long_break * jitter
                        logging.info(
                            f"☕ Batch #{(i + 1) // batch_size} done — human-like break: {int(sleep_time)}s"
                        )
                        self._idle_browsing()
                        if not self._sleep(sleep_time):
                            break
                    elif not is_last:
                        sleep_time = random.uniform(min_delay, max_delay)
                        logging.info(f"   ⏱  Next message in {int(sleep_time)}s…")
                        if not self._sleep(sleep_time):
                            break

            if not self.sending and not result["session_lost"]:
                result["stopped"] = True

        except Exception as exc:
            logging.error(f"💥 Critical mission error: {exc}", exc_info=True)
            result["error"] = str(exc)
        return self._finish_mission(result)

    def _finish_mission(self, result: dict) -> dict:
        was_stopped_by_user = not self.sending
        self.sending = False
        self.running = False
        self.paused = False
        self._pause_event.clear()
        result.update({
            "sent": self.stats["sent"],
            "failed": self.stats["failed"],
            "skipped": self.stats["skipped"],
        })
        if "stopped" not in result:
            result["stopped"] = was_stopped_by_user
        logging.info(
            f"🏁 Mission finished — sent={result['sent']} failed={result['failed']} "
            f"skipped={result['skipped']} stopped={result['stopped']}"
        )
        return result

    def _wait_for_session_window(self) -> bool:
        while not self._is_within_session_window() and self.sending:
            if not self._sleep(60):
                return False
        return self.sending

    # ── Single message ─────────────────────────────────────────────

    def _send_single_message(self, row, current: int, total: int) -> str:
        try:
            phone   = self._normalize_phone(row['phone'])
            message = str(row.get('message', '')).strip()
            msg_id  = row.get('id', f'msg_{current}')

            if not message:
                self._update_status(msg_id, 'skipped')
                self.stats["skipped"] += 1
                return 'skipped'

            if not validate_phone(phone):
                logging.warning(f"[{current}/{total}] ⚠️  Invalid phone: {phone}")
                self._update_status(msg_id, 'invalid_phone')
                self.stats["skipped"] += 1
                return 'invalid_phone'

            logging.info(f"[{current}/{total}] Processing: {phone}")
            self._update_status(msg_id, 'sending')

            # A dialog left over from an earlier row would block this one too.
            if self._invalid_dialog() is not None:
                self._dismiss_dialog()

            # فتح المحادثة: بحث الواجهة أولاً، ثم رابط الإرسال للأرقام غير المحفوظة
            if not self._open_chat(phone):
                logging.warning(f"  ⚠️  Could not open a chat with {phone}")
                self._dismiss_dialog()
                self._update_status(msg_id, 'failed')
                self.stats["failed"] += 1
                return 'failed'

            # WhatsApp raises this dialog for a number it cannot reach. The send link also
            # raises it spuriously while the app is still booting, so it is dismissed and the
            # in-app search is tried once before the number is written off as unreachable.
            if self._invalid_dialog() is not None:
                logging.warning(f"  ⚠️  WhatsApp rejected {phone} — retrying through the in-app search…")
                self._dismiss_dialog()
                if not self._open_chat_via_search(phone) or self._invalid_dialog() is not None:
                    logging.warning(f"  ❌ {phone} has no WhatsApp account — skipping.")
                    self._dismiss_dialog()
                    self._update_status(msg_id, 'invalid_phone')
                    self.stats["skipped"] += 1
                    return 'invalid_phone'
                logging.info(f"  ✅ {phone} opened on the retry — the first rejection was spurious.")

            # Simulate reading / thinking time
            time.sleep(random.uniform(2, 5))
            self._simulate_human_activity()

            # Send attachment first (if any)
            attachment = row.get('attachment')
            if attachment and str(attachment).strip() and str(attachment).strip() != 'None':
                self._send_attachment(str(attachment).strip())
                time.sleep(random.uniform(2, 4))

            # Find input box
            input_box = _find_first(self.driver, _SELECTORS["input_box"], timeout=10)
            if input_box is None:
                logging.warning(f"  ⚠️  Could not find input box for {phone}")
                self._update_status(msg_id, 'failed')
                self.stats["failed"] += 1
                return 'failed'

            logging.info("  → Typing message…")
            if not self._compose_message(input_box, message):
                logging.error(f"  ❌ Message never reached the composer for {phone} — not sending.")
                self._update_status(msg_id, 'failed')
                self.stats["failed"] += 1
                return 'failed'

            self._reading_pause()          # look at the typed text before sending

            if not self._press_send(input_box):
                logging.error(f"  ❌ Message stayed in the composer for {phone} — send failed.")
                self._update_status(msg_id, 'failed')
                self.stats["failed"] += 1
                return 'failed'

            logging.info(f"  ✅ Sent → {phone}")
            self._update_status(msg_id, 'sent')
            self.stats["sent"] += 1
            return 'sent'

        except NoSuchWindowException:
            logging.error("  ❌ WhatsApp window was closed — session lost.")
            self._update_status(row.get('id', ''), 'pending')
            return 'session_lost'
        except StaleElementReferenceException:
            logging.warning(f"  ⚠️  Stale element for {row.get('phone', '?')} — retrying skipped")
            self._update_status(row.get('id', ''), 'failed')
            self.stats["failed"] += 1
            return 'failed'
        except Exception as exc:
            logging.error(f"  ❌ Send failed for {row.get('phone', '?')}: {exc}")
            self._update_status(row.get('id', ''), 'failed')
            self.stats["failed"] += 1
            return 'failed'

    # ── Attachment ─────────────────────────────────────────────────

    def _send_attachment(self, file_path: str):
        if not os.path.exists(file_path) or not is_safe_path(file_path):
            logging.error(f"Invalid/unsafe attachment path: {file_path}")
            return
        try:
            attach_btn = _find_first(self.driver, _SELECTORS["attach_btn"], timeout=10)
            if attach_btn is None:
                logging.warning("  ⚠️  Attach button not found")
                return
            attach_btn.click()
            time.sleep(random.uniform(0.8, 1.5))

            file_input = _find_first(self.driver, _SELECTORS["file_input"], timeout=5)
            if file_input is None:
                logging.warning("  ⚠️  File input not found")
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                return

            file_input.send_keys(os.path.abspath(file_path))

            send_btn = _find_first(self.driver, _SELECTORS["send_btn"], timeout=10)
            if send_btn:
                time.sleep(random.uniform(1.0, 2.0))
                send_btn.click()
                logging.info(f"  📎 Attachment queued: {os.path.basename(file_path)}")
            else:
                logging.warning("  ⚠️  Send button not found after attach")
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()

        except Exception as exc:
            logging.error(f"  ⚠️  Attachment error: {exc}")
            try:
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
            except Exception:
                pass

    # ── Composing & sending ────────────────────────────────────────

    @staticmethod
    def _normalize_for_compare(value: str) -> str:
        """Collapse whitespace so composer text can be compared with the intended message."""
        return re.sub(r'\s+', ' ', (value or '')).strip()

    def _composer_text(self, element) -> str:
        """Read back what the editor currently holds."""
        try:
            return str(self.driver.execute_script(_COMPOSER_TEXT_JS, element) or '')
        except WebDriverException:
            return ''

    def _clear_composer(self, element) -> None:
        _mod_key = Keys.COMMAND if PLATFORM == 'Darwin' else Keys.CONTROL
        try:
            element.click()
            ActionChains(self.driver).key_down(_mod_key).send_keys('a').key_up(_mod_key).perform()
            time.sleep(0.1)
            ActionChains(self.driver).send_keys(Keys.BACKSPACE).perform()
            time.sleep(0.2)
        except WebDriverException:
            pass

    def _compose_message(self, input_box, message: str) -> bool:
        """
        Put ``message`` into the composer and PROVE it landed there.

        WhatsApp Web's editor rejects some synthetic input silently, which used to leave the
        composer empty while the caller happily pressed Enter and recorded a successful send.
        Each strategy is therefore verified by reading the editor back; only a verified
        composer is allowed to proceed to the send step.
        """
        expected = self._normalize_for_compare(message)
        strategies = (
            ('human typing', self._type_like_human),
            ('direct keys', self._type_direct),
            ('insertText command', self._insert_text_via_command),
        )

        for label, strategy in strategies:
            try:
                strategy(input_box, message)
            except StaleElementReferenceException:
                raise
            except Exception as exc:
                logging.warning(f"  ⚠️  Compose via {label} raised: {exc}")

            actual = self._normalize_for_compare(self._composer_text(input_box))
            if actual and (actual == expected or expected in actual):
                logging.info(f"  ✎ Composer holds the message ({label}).")
                return True

            logging.warning(
                f"  ⚠️  Composer still wrong after {label} "
                f"(holds {len(actual)} chars, expected {len(expected)}) — retrying."
            )
            self._clear_composer(input_box)

        return False

    def _type_like_human(self, element, text: str) -> None:
        """
        Human-like key-by-key typing.

        Newlines are sent as SHIFT+ENTER: a bare ENTER would submit the message halfway.
        """
        element.click()
        time.sleep(random.uniform(0.4, 1.0))  # Pause to show the "typing…" indicator

        speed_factor = random.uniform(0.7, 1.3)
        for line_index, line in enumerate(text.split('\n')):
            if line_index > 0:
                ActionChains(self.driver).key_down(Keys.SHIFT).send_keys(Keys.ENTER).key_up(Keys.SHIFT).perform()
                time.sleep(random.uniform(0.1, 0.3))

            words = line.split(' ')
            for i, word in enumerate(words):
                for char in word:
                    element.send_keys(char)
                    # Arabic characters are typed slower than digits/English
                    if '؀' <= char <= 'ۿ' or 'ݐ' <= char <= 'ݿ':
                        delay = random.uniform(0.02, 0.10) * speed_factor
                    elif char.isdigit():
                        delay = random.uniform(0.01, 0.05) * speed_factor
                    else:
                        delay = random.uniform(0.01, 0.08) * speed_factor
                    time.sleep(delay)

                    # Occasional typo (0.5% chance)
                    if random.random() < 0.005:
                        element.send_keys(Keys.BACKSPACE)
                        time.sleep(random.uniform(0.15, 0.35))
                        element.send_keys(char)

                if i < len(words) - 1:
                    element.send_keys(' ')
                    time.sleep(random.uniform(0.03, 0.12))

                # Pause at sentence-ending punctuation
                if word and word[-1] in '.!؟?،,:':
                    time.sleep(random.uniform(0.2, 0.6))

                # Occasional mid-sentence "thinking" pause (3% chance)
                if random.random() < 0.03:
                    time.sleep(random.uniform(0.4, 1.0))

    def _type_direct(self, element, text: str) -> None:
        """One send_keys per line — faster, still real key events."""
        element.click()
        time.sleep(random.uniform(0.2, 0.5))
        for line_index, line in enumerate(text.split('\n')):
            if line_index > 0:
                ActionChains(self.driver).key_down(Keys.SHIFT).send_keys(Keys.ENTER).key_up(Keys.SHIFT).perform()
            if line:
                element.send_keys(line)
            time.sleep(random.uniform(0.1, 0.3))

    def _insert_text_via_command(self, element, text: str) -> None:
        """
        Last resort: `insertText` fires the same beforeinput/input events the editor listens
        for, so the rich-text editor accepts it. A dispatched ClipboardEvent does not work —
        the editor ignores untrusted paste events, which is what silently dropped messages.
        """
        element.click()
        time.sleep(random.uniform(0.2, 0.5))
        self.driver.execute_script(
            "arguments[0].focus();"
            "document.execCommand('insertText', false, arguments[1]);",
            element, text
        )
        time.sleep(random.uniform(0.3, 0.7))

    def _press_send(self, input_box) -> bool:
        """
        Send the composed message and confirm it actually left the composer.
        Prefers the send button, falls back to ENTER.
        """
        before = self._normalize_for_compare(self._composer_text(input_box))
        if not before:
            logging.warning("  ⚠️  Nothing to send — composer is empty.")
            return False

        send_btn = _find_first(self.driver, _SELECTORS["send_btn"], timeout=3)
        if send_btn is not None:
            try:
                send_btn.click()
            except WebDriverException:
                try:
                    self.driver.execute_script("arguments[0].click();", send_btn)
                except WebDriverException:
                    send_btn = None
        if send_btn is None:
            try:
                input_box.send_keys(Keys.ENTER)
            except WebDriverException as exc:
                logging.warning(f"  ⚠️  ENTER failed: {exc}")
                return False

        # The composer empties once WhatsApp accepts the message.
        deadline = time.time() + 12
        while time.time() < deadline:
            time.sleep(0.4)
            if not self._normalize_for_compare(self._composer_text(input_box)):
                time.sleep(random.uniform(0.6, 1.4))   # let the bubble render
                return True

        # One last attempt with ENTER in case the button click was swallowed.
        try:
            input_box.send_keys(Keys.ENTER)
            time.sleep(1.5)
            return not self._normalize_for_compare(self._composer_text(input_box))
        except WebDriverException:
            return False

    # ── Human simulation ───────────────────────────────────────────

    # ── Opening a conversation ─────────────────────────────────────

    # Arabic-Indic and Persian numerals, so a row rendered as ٩٦٦٥٠… still matches 96650…
    _DIGIT_TRANSLATION = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')

    @classmethod
    def _digits(cls, value: str) -> str:
        return re.sub(r'\D', '', (value or '').translate(cls._DIGIT_TRANSLATION))

    def _row_matches_phone(self, row, phone: str) -> bool:
        """
        True when a search-result row really belongs to ``phone``.

        WhatsApp prints an unsaved number formatted ("+966 50 123 4567"), so a raw
        substring match on the digits never fires. Comparing digit-only text instead
        recognises the unsaved-number row, and — just as important — stops the bot from
        opening whatever row happens to sit at the top of the list.
        """
        target = phone[-9:]
        if not target:
            return False
        try:
            haystack = ' '.join(filter(None, [
                row.text or '',
                row.get_attribute('title') or '',
                row.get_attribute('aria-label') or ''
            ]))
        except (StaleElementReferenceException, WebDriverException):
            return False
        return target in self._digits(haystack)

    # Rows that can appear in the "new chat" search results.
    _SEARCH_ROW_XPATHS = (
        '//div[@data-testid="cell-frame-container"]',
        '//div[@data-testid="chat-list-item"]',
        '//div[@id="pane-side"]//div[@role="listitem"]',
        '//div[@role="listitem"]',
        '//div[@role="button"][@aria-label]',
    )

    def _await_matching_row(self, phone: str, timeout: float = 9):
        """
        Wait for a search-result row that really belongs to ``phone``.

        The row for a number that is not in the address book arrives late: WhatsApp has to ask
        its servers whether the number has an account first. A single look right after typing
        usually happens before that answer lands, which is why unsaved numbers looked absent.
        """
        deadline = time.time() + timeout
        while True:
            rows = []
            for xpath in self._SEARCH_ROW_XPATHS:
                try:
                    rows.extend(self.driver.find_elements(By.XPATH, xpath))
                except WebDriverException:
                    continue
            match = next((row for row in rows if self._row_matches_phone(row, phone)), None)
            if match is not None:
                return match
            if time.time() >= deadline:
                return None
            time.sleep(0.6)

    def _invalid_dialog(self):
        """Return WhatsApp's "this number is not on WhatsApp" dialog if it is on screen."""
        return _find_first(self.driver, _SELECTORS["invalid_popup"])

    def _dismiss_dialog(self) -> bool:
        """
        Close a blocking WhatsApp dialog.

        This matters far beyond the message that triggered it: a modal stays on top of the
        app, so leaving it open made every later message in the batch fail too — one number
        without WhatsApp used to poison the whole run.
        """
        button_xpaths = [
            '//div[@role="dialog"]//button[normalize-space()="OK"]',
            '//div[@role="dialog"]//button[normalize-space()="Ok"]',
            '//div[@role="dialog"]//button[normalize-space()="حسنًا"]',
            '//div[@role="dialog"]//button[normalize-space()="حسناً"]',
            '//div[@role="dialog"]//button[normalize-space()="موافق"]',
            '//div[@role="dialog"]//button[normalize-space()="إغلاق"]',
            '//div[@role="dialog"]//div[@role="button"]',
            '//div[@role="dialog"]//button',
        ]
        button = _find_first(self.driver, button_xpaths, timeout=2)
        if button is not None:
            try:
                button.click()
            except WebDriverException:
                try:
                    self.driver.execute_script("arguments[0].click();", button)
                except WebDriverException:
                    pass
        else:
            try:
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
            except WebDriverException:
                pass

        deadline = time.time() + 6
        while time.time() < deadline:
            time.sleep(0.4)
            if self._invalid_dialog() is None:
                logging.info("  🧹 Dismissed the WhatsApp dialog.")
                return True
            try:
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
            except WebDriverException:
                break
        logging.warning("  ⚠️  A WhatsApp dialog is still on screen.")
        return False

    def _open_chat(self, phone: str) -> bool:
        """
        Open the conversation for ``phone``, saved in the address book or not.

        The UI search is tried first because it keeps the session looking human and avoids
        a page reload, but its result is only accepted when the row's own digits match the
        target. Anything unverified goes to the send link, which is the one route that
        always works for a number that is not in the contact list.
        """
        if self._open_chat_via_search(phone):
            return True
        return self._open_chat_via_link(phone)

    def _open_chat_via_link(self, phone: str) -> bool:
        """Open a chat through WhatsApp's send link — the reliable route for unsaved numbers."""
        logging.info(f"  🔗 Opening {phone} through the send link (works for unsaved numbers)…")
        try:
            self.driver.get(f"https://web.whatsapp.com/send?phone={phone}")
        except WebDriverException as nav_err:
            logging.error(f"  ❌ Navigation failed: {nav_err}")
            return False

        try:
            WebDriverWait(self.driver, 25).until(
                lambda d: d.execute_script("return document.readyState === 'complete'")
            )
        except (TimeoutException, WebDriverException):
            pass

        input_xpath = " | ".join(_SELECTORS["input_box"])
        invalid_xpath = " | ".join(_SELECTORS["invalid_popup"])
        try:
            WebDriverWait(self.driver, 60).until(
                EC.presence_of_element_located((By.XPATH, f"{input_xpath} | {invalid_xpath}"))
            )
        except TimeoutException:
            logging.warning(f"  ⚠️  Timed out waiting for the chat with {phone}")
            return False

        return bool(_find_first(self.driver, _SELECTORS["input_box"]))

    def _open_chat_via_search(self, phone: str) -> bool:
        """فتح المحادثة عبر واجهة المستخدم لمحاكاة البشر ومنع إعادة تحميل الصفحة."""
        _mod_key = Keys.COMMAND if PLATFORM == 'Darwin' else Keys.CONTROL

        try:
            # ── الخطوة 1: النقر على أيقونة محادثة جديدة ──
            new_chat_xpaths = [
                '//span[@data-icon="new-chat-outline"]',
                '//div[@data-testid="chat-list-header-menu-new"]',
                '//span[@data-icon="chat"]',
                '//div[@title="New chat"]',
                '//div[@aria-label="New chat"]',
                '//div[@aria-label="محادثة جديدة"]',
            ]
            new_chat_btn = _find_first(self.driver, new_chat_xpaths, timeout=8)
            if new_chat_btn:
                new_chat_btn.click()
                time.sleep(random.uniform(0.8, 1.5))

            # ── الخطوة 2: إيجاد مربع البحث ──
            search_xpaths = [
                '//div[@data-testid="chat-list-search"]',
                '//div[@contenteditable="true"][@data-tab="3"]',
                '//div[@id="side"]//div[@contenteditable="true"]',
                '//div[@role="textbox"][@title="Search input textbox"]',
                '//div[@role="textbox"][@title]',
            ]
            search_box = _find_first(self.driver, search_xpaths, timeout=8)
            if not search_box:
                logging.warning(f"  ⚠️  Search box not found for {phone}")
                return False

            search_box.click()
            time.sleep(random.uniform(0.3, 0.6))

            # ── مسح أي نص سابق ──
            ActionChains(self.driver).key_down(_mod_key).send_keys('a').key_up(_mod_key).perform()
            time.sleep(0.1)
            ActionChains(self.driver).send_keys(Keys.DELETE).perform()
            time.sleep(random.uniform(0.3, 0.5))

            # ── الخطوة 3: كتابة الرقم ببطء كالبشر ──
            for char in phone:
                search_box.send_keys(char)
                time.sleep(random.uniform(0.04, 0.12))

            # ── انتظار ظهور نتائج البحث ──
            time.sleep(random.uniform(2.5, 4.0))

            # ── الخطوة 4: اختيار النتيجة التي تطابق الرقم فعلاً ──
            # لا يُنقر على أول صف مهما كان: ذلك كان يفتح محادثة شخص آخر حين لا تظهر
            # نتيجة للرقم، ويتخطى الأرقام غير المحفوظة لأنها تُعرض بصيغة منسّقة.
            contact = self._await_matching_row(phone)
            if contact is None:
                logging.info(f"  ℹ️  No search result matched {phone} — will use the send link.")
            if contact:
                try:
                    contact.click()
                except WebDriverException:
                    # أحياناً العنصر ليس قابلاً للنقر مباشرة، نحاول العنصر الأب
                    try:
                        self.driver.execute_script("arguments[0].click();", contact)
                    except WebDriverException:
                        pass

                time.sleep(random.uniform(1.5, 2.5))

                # ── التحقق من أن المحادثة فُتحت فعلاً ──
                input_xpath = " | ".join(_SELECTORS["input_box"])
                try:
                    WebDriverWait(self.driver, 8).until(
                        EC.presence_of_element_located((By.XPATH, input_xpath))
                    )
                    return True
                except TimeoutException:
                    logging.warning(f"  ⚠️  Chat opened but input box not found for {phone}")

            # ── تنظيف: مسح البحث والخروج ──
            try:
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                time.sleep(0.3)
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
            except WebDriverException:
                pass
            return False

        except Exception as e:
            logging.error(f"UI Search failed for {phone}: {e}")
            try:
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
            except WebDriverException:
                pass
            return False

    # ── Bezier curve mouse movement ────────────────────────────────

    @staticmethod
    def _bezier_point(t: float, p0, p1, p2, p3):
        """Calculate cubic Bezier curve point at parameter t."""
        u = 1 - t
        return (
            u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
        )

    def _move_mouse_bezier(self, target_x: int, target_y: int, steps: int = 0):
        """
        Move mouse along a natural Bezier curve to (target_x, target_y).
        Uses random control points for organic-looking movement.
        """
        if not self.driver:
            return
        try:
            if steps == 0:
                steps = random.randint(12, 25)

            p0 = (0, 0)  # relative start
            p3 = (target_x, target_y)  # relative end
            # Random control points for curve shape
            p1 = (random.randint(-30, target_x + 30), random.randint(-30, target_y + 30))
            p2 = (random.randint(-30, target_x + 30), random.randint(-30, target_y + 30))

            actions = ActionChains(self.driver)
            prev = (0, 0)
            for i in range(1, steps + 1):
                t = i / steps
                point = self._bezier_point(t, p0, p1, p2, p3)
                dx = int(point[0] - prev[0])
                dy = int(point[1] - prev[1])
                if dx != 0 or dy != 0:
                    actions.move_by_offset(dx, dy)
                    actions.pause(random.uniform(0.005, 0.025))
                prev = (prev[0] + dx, prev[1] + dy)
            actions.perform()
        except Exception:
            pass

    def _simulate_human_activity(self):
        """Bezier-curve mouse movement + small scroll — avoids looking idle."""
        if not self.driver:
            return
        try:
            # Natural Bezier curve mouse movement
            dx = random.randint(-60, 60)
            dy = random.randint(-60, 60)
            self._move_mouse_bezier(dx, dy)
            time.sleep(random.uniform(0.3, 0.8))

            # Random scroll
            scroll_px = random.randint(50, 300)
            self.driver.execute_script(f"window.scrollBy(0,{scroll_px});")
            time.sleep(random.uniform(0.2, 0.6))
            self.driver.execute_script(f"window.scrollBy(0,{-scroll_px});")
        except Exception:
            pass

    def _reading_pause(self):
        """Short pause after typing — simulates the user re-reading the message."""
        msg_read_time = random.uniform(1.0, 3.5)
        time.sleep(msg_read_time)

    def _idle_browsing(self):
        """
        Simulate idle browsing between batches:
        browse random existing chats, scroll around, then return.
        This makes the session look like a real user.
        """
        if not self.driver:
            return
        try:
            logging.info("👀 Idle browsing — simulating casual usage…")
            # Click on a random chat in the sidebar
            chats = self.driver.find_elements(By.XPATH, '//div[@data-testid="cell-frame-container"]')
            if chats and len(chats) > 2:
                random_chat = random.choice(chats[:min(8, len(chats))])
                random_chat.click()
                time.sleep(random.uniform(2, 5))

                # Scroll through messages
                for _ in range(random.randint(1, 3)):
                    scroll = random.randint(100, 400)
                    self.driver.execute_script(f"window.scrollBy(0, -{scroll});")
                    time.sleep(random.uniform(1, 3))

                # Move mouse around naturally
                self._move_mouse_bezier(random.randint(-50, 50), random.randint(-50, 50))
                time.sleep(random.uniform(1, 3))

        except Exception:
            pass  # Non-critical — best effort

    def _is_within_session_window(self) -> bool:
        """
        Check if current time is within a realistic session window.
        Returns False during 1:00 AM – 6:00 AM (only used when respect_session_window=True).
        """
        hour = datetime.now().hour
        return not (1 <= hour < 6)

    # ── Queue helpers ──────────────────────────────────────────────

    def _read_queue(self):
        try:
            if self.file_lock:
                with self.file_lock:
                    return sqlite_db.get_queue()
            return sqlite_db.get_queue()
        except Exception as exc:
            logging.error(f"Queue read error: {exc}")
            return []

    def _pending_rows(self):
        return [
            row for row in self._read_queue()
            if (row.get('status') or '') in ('', 'pending', 'sending')
        ]

    def _reset_stuck_rows(self):
        if self.file_lock:
            with self.file_lock:
                sqlite_db.reset_stuck_sending()
        else:
            sqlite_db.reset_stuck_sending()

    def _update_status(self, msg_id: str, status: str):
        if not self.file_lock:
            sqlite_db.update_status(msg_id, status)
            return
        try:
            with self.file_lock:
                sqlite_db.update_status(msg_id, status)
        except Exception as exc:
            logging.error(f"Status update failed for {msg_id}: {exc}")

    # ── Phone utils ────────────────────────────────────────────────

    def _normalize_phone(self, phone) -> str:
        arabic_map = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
        p = str(phone).strip().translate(arabic_map)
        p = p.replace('+', '').replace(' ', '').replace('-', '')
        # Saudi local format → international
        if p.startswith('05') and len(p) == 10:
            p = '966' + p[1:]
        elif p.startswith('5') and len(p) == 9:
            p = '966' + p
        return p


# ─────────────────────────────────────────────────────────────────
# Standalone usage
# ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    target = "contacts.db"
    if os.path.exists(target):
        tool = WhatsAppProTool(target)
        try:
            if tool.init_browser() and tool.open_whatsapp() and tool.wait_for_login(timeout=15 * 60):
                tool.bring_to_front()
                tool.run_mission(
                    batch_size=8,
                    min_delay=10,
                    max_delay=25,
                    long_break=90,
                )
        finally:
            tool.close()
