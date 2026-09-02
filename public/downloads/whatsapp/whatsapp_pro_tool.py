"""
WhatsApp Pro Tool — Cross-Platform Automation Engine v4.0
=========================================================
• Supports macOS, Windows, and Linux
• Human-behaviour simulation (typing bursts, reading pauses, Bezier mouse, scroll)
• Load distribution: configurable batch_size, inter-message delays, batch breaks
• Anti-detection: stealth fingerprints, CDP hiding, Canvas/WebGL protection
• Robust element detection: data-testid + legacy XPath fallbacks
• Thread-safe SQLite queue with status tracking & retry mechanism
• Automatic browser refresh to clear memory every N messages
• Session time windows to avoid sending during unrealistic hours
• Idle browsing simulation between message batches
"""

import os
import sys
import re
import json
import math
import platform
import subprocess
import tempfile
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
    TimeoutException, NoSuchElementException,
    WebDriverException, StaleElementReferenceException
)
from webdriver_manager.chrome import ChromeDriverManager

# ─────────────────────────────────────────────────────────────────
# Paths & Platform
# ─────────────────────────────────────────────────────────────────
PLATFORM = platform.system()   # 'Darwin' | 'Windows' | 'Linux'
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
USER_DATA_DIR = os.path.join(BASE_DIR, "whatsapp_session")

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
    # Invalid-number popup
    "invalid_popup": [
        '//*[contains(text(),"invalid")]',
        '//*[contains(text(),"غير صحيح")]',
        '//*[contains(text(),"Phone number shared via url is invalid")]',
    ],
}


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

    Human-simulation highlights
    ───────────────────────────
    • _human_typing   – character-level delays, word pauses, sentence rest, rare typo
    • _simulate_human_activity – random mouse micro-jitter + small scroll
    • _reading_pause  – variable delay before sending (simulates reading the draft)

    Load-distribution defaults (configurable via run_mission args)
    ─────────────────────────────────────────────────────────────
    batch_size  = 5   → send 5 messages, then take a long break
    min_delay   = 25s → minimum gap between two messages (within batch)
    max_delay   = 60s → maximum gap between two messages
    long_break  = 180s→ base break length after each full batch (±20 % jitter)
    """

    def __init__(self, db_path: str, file_lock=None):
        self.db_path   = db_path
        self.file_lock = file_lock
        self.driver    = None
        self.wait      = None
        self.running   = False
        self.message_count = 0
        self.last_activity_time = time.time()
        # Refresh every 15–25 messages to prevent memory leaks
        self.refresh_threshold = random.randint(15, 25)
        self.stats = {"sent": 0, "failed": 0, "skipped": 0, "total": 0, "start_time": None}

    # ── Lifecycle ──────────────────────────────────────────────────

    def stop(self):
        self.running = False
        logging.info("⏹  Stop signal received.")

    def get_stats(self):
        """Get current statistics"""
        return {**self.stats}

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
        opts.add_argument("--disable-gpu")
        opts.add_argument("--remote-debugging-port=0")
        opts.add_argument("--disable-infobars")
        opts.add_argument("--disable-notifications")
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

        return opts

    def _get_stealth_js(self) -> str:
        """Return comprehensive stealth JavaScript to inject on every page load."""
        return """
        // ═══════════════════════════════════════════════════════
        // 1. Hide navigator.webdriver
        // ═══════════════════════════════════════════════════════
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
        });

        // ═══════════════════════════════════════════════════════
        // 2. Realistic navigator.plugins (Chrome PDF Viewer etc.)
        // ═══════════════════════════════════════════════════════
        const fakePluginData = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer',
              description: 'Portable Document Format',
              mimeTypes: [{type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format'}] },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
              description: '',
              mimeTypes: [{type: 'application/pdf', suffixes: 'pdf', description: ''}] },
            { name: 'Native Client', filename: 'internal-nacl-plugin',
              description: '',
              mimeTypes: [{type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable'},
                          {type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable'}] }
        ];

        const fakePluginArray = fakePluginData.map(p => {
            const plugin = Object.create(Plugin.prototype);
            Object.defineProperties(plugin, {
                name:        { value: p.name, enumerable: true },
                filename:    { value: p.filename, enumerable: true },
                description: { value: p.description, enumerable: true },
                length:      { value: p.mimeTypes.length, enumerable: true }
            });
            p.mimeTypes.forEach((mt, i) => {
                const mimeType = Object.create(MimeType.prototype);
                Object.defineProperties(mimeType, {
                    type:           { value: mt.type, enumerable: true },
                    suffixes:       { value: mt.suffixes, enumerable: true },
                    description:    { value: mt.description, enumerable: true },
                    enabledPlugin:  { value: plugin, enumerable: true }
                });
                Object.defineProperty(plugin, i, { value: mimeType, enumerable: true });
            });
            return plugin;
        });

        const fakePlugins = Object.create(PluginArray.prototype);
        fakePluginArray.forEach((p, i) => {
            Object.defineProperty(fakePlugins, i, { value: p, enumerable: true });
            Object.defineProperty(fakePlugins, p.name, { value: p });
        });
        Object.defineProperty(fakePlugins, 'length', { value: fakePluginArray.length, enumerable: true });
        fakePlugins.item = function(i) { return this[i] || null; };
        fakePlugins.namedItem = function(name) { return this[name] || null; };
        fakePlugins.refresh = function() {};
        Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });

        // ═══════════════════════════════════════════════════════
        // 3. Languages
        // ═══════════════════════════════════════════════════════
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ar', 'ar-SA', 'en-US', 'en']
        });

        // ═══════════════════════════════════════════════════════
        // 4. Realistic window.chrome object
        // ═══════════════════════════════════════════════════════
        window.chrome = {
            app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
            runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' } }
        };

        // ═══════════════════════════════════════════════════════
        // 5. Permissions API — return realistic results
        // ═══════════════════════════════════════════════════════
        const origPermQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (params) =>
            params.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : origPermQuery.call(navigator.permissions, params);

        // ═══════════════════════════════════════════════════════
        // 6. Hardware concurrency & device memory
        // ═══════════════════════════════════════════════════════
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        if (navigator.deviceMemory !== undefined) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        }

        // ═══════════════════════════════════════════════════════
        // 7. Canvas fingerprint protection (subtle noise)
        // ═══════════════════════════════════════════════════════
        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attrs) {
            const ctx = origGetContext.call(this, type, attrs);
            if (type === '2d' && ctx) {
                const origGetImageData = ctx.getImageData;
                ctx.getImageData = function(...args) {
                    const imageData = origGetImageData.apply(this, args);
                    // Add very subtle noise to a few pixels
                    for (let i = 0; i < Math.min(imageData.data.length, 40); i += 4) {
                        imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.5 ? 1 : 0);
                    }
                    return imageData;
                };
            }
            return ctx;
        };

        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
            // Create subtle variation in canvas output
            const ctx = this.getContext('2d');
            if (ctx) {
                const style = ctx.fillStyle;
                ctx.fillStyle = 'rgba(0,0,0,0.004)';
                ctx.fillRect(0, 0, 1, 1);
                ctx.fillStyle = style;
            }
            return origToDataURL.apply(this, arguments);
        };

        // ═══════════════════════════════════════════════════════
        // 8. WebGL fingerprint protection
        // ═══════════════════════════════════════════════════════
        const origGetParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
            // UNMASKED_VENDOR_WEBGL
            if (param === 37445) return 'Google Inc. (NVIDIA)';
            // UNMASKED_RENDERER_WEBGL
            if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return origGetParameter.call(this, param);
        };
        if (typeof WebGL2RenderingContext !== 'undefined') {
            const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(param) {
                if (param === 37445) return 'Google Inc. (NVIDIA)';
                if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                return origGetParameter2.call(this, param);
            };
        }

        // ═══════════════════════════════════════════════════════
        // 9. Hide CDP (Chrome DevTools Protocol) indicators
        // ═══════════════════════════════════════════════════════
        // Remove Runtime.enable leak
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        // Remove all cdc_ prefixed properties
        for (const key of Object.keys(window)) {
            if (/^cdc_/.test(key)) { delete window[key]; }
        }

        // ═══════════════════════════════════════════════════════
        // 10. Prevent iframe detection
        // ═══════════════════════════════════════════════════════
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function() {
                return window;
            }
        });
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
                self.driver.execute_cdp_cmd(
                    "Page.addScriptToEvaluateOnNewDocument",
                    {"source": self._get_stealth_js()}
                )

                self.driver.set_page_load_timeout(60)
                self.wait = WebDriverWait(self.driver, 60)
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

    # ── Login ──────────────────────────────────────────────────────

    def check_login(self) -> bool:
        """
        Navigate to WhatsApp Web and wait up to 90 s for authentication.
        Returns True when the side-panel is visible (user is logged in).
        """
        self.driver.get("https://web.whatsapp.com")
        logging.info("📱 Waiting for WhatsApp authentication…")

        try:
            # Build a combined OR-XPath from all side-panel selectors
            combined = " | ".join(_SELECTORS["side_panel"])
            WebDriverWait(self.driver, 90).until(
                EC.presence_of_element_located((By.XPATH, combined))
            )
            logging.info("✅ Authenticated.")
            return True
        except TimeoutException:
            logging.warning("⏳ Login timeout — please scan the QR code.")
            return False

    # ── Mission ────────────────────────────────────────────────────

    def run_mission(
        self,
        batch_size: int  = 5,
        min_delay:  float = 25,
        max_delay:  float = 60,
        long_break: float = 180,
        continuous: bool  = False,
    ):
        """
        Execute the messaging mission.

        Parameters
        ──────────
        batch_size  – send N messages, then take a long break
        min_delay   – minimum sleep between messages (seconds)
        max_delay   – maximum sleep between messages (seconds)
        long_break  – base long-break duration after a full batch (±20 %)
        continuous  – keep polling queue for new items when empty
        """
        logging.info(
            f"🚀 Mission start — batch_size={batch_size}, "
            f"delay={min_delay}–{max_delay}s, break={long_break}s"
        )
        self.running = True
        self.stats["start_time"] = datetime.now().isoformat()

        # Session time window check — don't start in unrealistic hours
        if not self._is_within_session_window():
            hour = datetime.now().hour
            wake_hour = 6 + random.randint(0, 2)
            wait_minutes = (wake_hour - hour) % 24 * 60 + random.randint(0, 30)
            logging.info(f"🌙 Outside session window (hour={hour}). Sleeping {wait_minutes} min until ~{wake_hour}:00…")
            time.sleep(wait_minutes * 60)

        # Human warm-up: browse briefly before sending
        warmup = random.uniform(15, 45)
        logging.info(f"🧘 Human warm-up: browsing for {int(warmup)}s before starting…")
        time.sleep(warmup)

        try:
            while self.running:
                self.last_activity_time = time.time()
                queue = self._read_queue()
                if not queue:
                    if continuous:
                        time.sleep(5)
                        continue
                    break

                pending = [
                    row for row in queue 
                    if row.get('status') is None or row.get('status') == 'pending' or row.get('status') == ''
                ]
                
                if not pending:
                    if continuous:
                        time.sleep(10)
                        continue
                    break

                logging.info(f"📨 {len(pending)} messages pending in queue.")

                for i, row in enumerate(pending):
                    if not self.running:
                        break

                    # Periodic browser refresh
                    if (
                        self.message_count > 0
                        and self.message_count % self.refresh_threshold == 0
                    ):
                        logging.info("🔄 Refreshing browser to maintain performance…")
                        try:
                            self.driver.refresh()
                            time.sleep(random.uniform(8, 15))
                            if not self.check_login():
                                logging.error("❌ Session lost after refresh — stopping.")
                                self.running = False
                                break
                        except WebDriverException as refresh_err:
                            logging.error(f"Browser error after refresh: {refresh_err}")
                            self.running = False
                            break

                    self.last_activity_time = time.time()
                    self._send_single_message(row, i + 1, len(pending))
                    self.message_count += 1
                    self.last_activity_time = time.time()

                    # Session time window check between messages
                    if not self._is_within_session_window():
                        logging.info("🌙 Entering night hours — pausing until morning…")
                        while not self._is_within_session_window() and self.running:
                            time.sleep(300)  # Check every 5 minutes
                        if not self.running:
                            break
                        logging.info("☀️ Morning — resuming mission.")
                        # Re-warm after long sleep
                        time.sleep(random.uniform(30, 90))

                    # Batch break vs normal inter-message delay
                    if (i + 1) % batch_size == 0 and (i + 1) < len(pending):
                        jitter     = random.uniform(0.8, 1.2)
                        sleep_time = long_break * jitter
                        logging.info(
                            f"☕ Batch #{(i + 1) // batch_size} done — "
                            f"human-like break: {int(sleep_time)}s"
                        )
                        # Idle browsing during batch break
                        self._idle_browsing()
                        time.sleep(sleep_time)
                    else:
                        sleep_time = random.uniform(min_delay, max_delay)
                        logging.info(f"   ⏱  Next message in {int(sleep_time)}s…")
                        time.sleep(sleep_time)

        except Exception as exc:
            logging.error(f"💥 Critical mission error: {exc}", exc_info=True)
        finally:
            if self.driver:
                try:
                    self.driver.quit()
                except Exception:
                    pass
                logging.info("🔒 Browser closed safely.")

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

            # 1. محاولة فتح المحادثة كالبشر دون إعادة تحميل
            chat_opened = self._open_chat_human_like(phone)
            
            # Wait for input box OR invalid popup (whichever appears first)
            input_xpath   = " | ".join(_SELECTORS["input_box"])
            invalid_xpath = " | ".join(_SELECTORS["invalid_popup"])
            combined = f"{input_xpath} | {invalid_xpath}"

            # 2. خطة بديلة (Fallback) إذا فشل البحث في الواجهة
            if not chat_opened:
                logging.warning(f"  ⚠️  UI Search failed for {phone}, using fallback URL (page will reload)...")
                self.driver.get(f"https://web.whatsapp.com/send?phone={phone}")

                try:
                    WebDriverWait(self.driver, 40).until(
                        EC.presence_of_element_located((By.XPATH, combined))
                    )
                except TimeoutException:
                    logging.warning(f"  ⚠️  Timeout waiting for chat with {phone}")
                    self._update_status(msg_id, 'failed')
                    self.stats["failed"] += 1
                    return 'failed'

            # Check invalid popup
            for xpath in _SELECTORS["invalid_popup"]:
                if self.driver.find_elements(By.XPATH, xpath):
                    logging.warning(f"  ❌ Phone {phone} not on WhatsApp.")
                    self._update_status(msg_id, 'invalid_phone')
                    self.stats["skipped"] += 1
                    return 'invalid_phone'

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
            self._human_typing(input_box, message)
            self._reading_pause()          # look at the typed text before sending

            input_box.send_keys(Keys.ENTER)
            time.sleep(random.uniform(1.5, 3.0))   # wait for send confirmation

            logging.info(f"  ✅ Sent → {phone}")
            self._update_status(msg_id, 'sent')
            self.stats["sent"] += 1
            return 'sent'

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

    # ── Human simulation ───────────────────────────────────────────

    def _human_typing(self, element, text: str):
        """
        Simulate natural typing with diversified patterns:
        - Arabic chars: slower (0.02–0.10s)
        - Digits: faster (0.01–0.05s)
        - Sentence pauses at punctuation
        - Occasional typo + correction
        - Variable burst speed
        """
        try:
            element.click()
            time.sleep(random.uniform(0.5, 1.2))  # Pause to show "typing..." indicator

            # If message is very long, paste it to save time, but act human
            if len(text) > 150:
                self._paste_message(element, text)
                return

            # Randomize overall typing speed profile for this message
            speed_factor = random.uniform(0.7, 1.3)

            words = text.split(' ')
            for i, word in enumerate(words):
                for char in word:
                    element.send_keys(char)
                    # Arabic characters are typed slower than digits/English
                    if '\u0600' <= char <= '\u06FF' or '\u0750' <= char <= '\u077F':
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

        except Exception as exc:
            logging.error(f"Human typing error: {exc}")
            try:
                element.send_keys(text)   # Fallback: paste entire text
            except Exception:
                pass

    def _paste_message(self, input_box, text):
        """Paste full message using JavaScript to preserve formatting and look human-ish"""
        try:
            input_box.click()
            time.sleep(random.uniform(0.3, 0.8))
            escaped = text.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
            self.driver.execute_script(f"""
                const text = `{escaped}`;
                const dt = new DataTransfer();
                dt.setData('text/plain', text);
                const pasteEvent = new ClipboardEvent('paste', {{
                    clipboardData: dt,
                    bubbles: true,
                    cancelable: true
                }});
                arguments[0].dispatchEvent(pasteEvent);
            """, input_box)
            time.sleep(random.uniform(0.5, 1.0))
        except Exception:
            self._human_typing(input_box, text)

    def _open_chat_human_like(self, phone: str) -> bool:
        """فتح المحادثة عبر واجهة المستخدم لمحاكاة البشر ومنع إعادة تحميل الصفحة"""
        try:
            # النقر على أيقونة محادثة جديدة
            try:
                new_chat_btn = self.wait.until(EC.element_to_be_clickable((By.XPATH, '//div[@title="New chat"] | //span[@data-icon="new-chat-outline"] | //span[@data-icon="chat"]')))
                new_chat_btn.click()
                time.sleep(random.uniform(0.8, 1.5))
            except TimeoutException:
                pass  # قد نكون بالفعل في شاشة تسمح بالبحث

            # البحث عن مربع البحث
            search_box = self.wait.until(EC.presence_of_element_located((By.XPATH, '//div[@contenteditable="true"][@data-tab="3"] | //div[@id="side"]//div[@contenteditable="true"]')))
            search_box.click()

            # مسح المربع
            _mod_key = Keys.COMMAND if PLATFORM == 'Darwin' else Keys.CONTROL
            ActionChains(self.driver).key_down(_mod_key).send_keys('a').key_up(_mod_key).send_keys(Keys.BACKSPACE).perform()
            time.sleep(random.uniform(0.3, 0.7))

            # كتابة الرقم ببطء كالبشر (أرقام أسرع قليلاً)
            for char in phone:
                search_box.send_keys(char)
                time.sleep(random.uniform(0.04, 0.12))

            # انتظار ظهور النتائج من الخادم
            time.sleep(random.uniform(2.0, 3.5))

            # محاولة ضغط إنتر لفتح المحادثة مباشرة
            search_box.send_keys(Keys.ENTER)
            time.sleep(random.uniform(1.2, 2.0))

            # التحقق من أن المحادثة فُتحت
            input_xpath = " | ".join(_SELECTORS["input_box"])
            try:
                self.driver.find_element(By.XPATH, input_xpath)
                return True
            except NoSuchElementException:
                # إذا لم تُفتح، البحث عن الرقم في القائمة والنقر عليه
                try:
                    contact = self.driver.find_element(By.XPATH, f'//span[contains(@title, "{phone}")] | //span[contains(text(), "{phone}")] | //div[@role="button"]//span[contains(text(), "{phone}")]')
                    contact.click()
                    time.sleep(random.uniform(1.0, 2.0))
                    return True
                except NoSuchElementException:
                    # تفريغ المربع والخروج إذا لم يوجد
                    _mod_key = Keys.COMMAND if PLATFORM == 'Darwin' else Keys.CONTROL
                    ActionChains(self.driver).key_down(_mod_key).send_keys('a').key_up(_mod_key).send_keys(Keys.BACKSPACE).send_keys(Keys.ESCAPE).perform()
                    return False
        except Exception as e:
            logging.error(f"UI Search failed for {phone}: {e}")
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
        Returns False during 1:00 AM – 6:00 AM to avoid suspicious activity.
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
        if tool.init_browser() and tool.check_login():
            tool.run_mission(
                batch_size=5,
                min_delay=25,
                max_delay=60,
                long_break=180,
            )
