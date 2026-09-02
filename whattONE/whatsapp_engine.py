import pandas as pd
import time
import random
import logging
import os
import sys
import re
import subprocess
import threading
import json
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager
import platform

PLATFORM = platform.system()  # 'Darwin' | 'Windows' | 'Linux'

# --- Configuration ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SESSION_DIR = os.path.join(BASE_DIR, "session_data")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")

# Allowed upload directories (security)
import tempfile
ALLOWED_UPLOAD_DIRS = [
    os.path.abspath(UPLOADS_DIR),
    tempfile.gettempdir(),  # Cross-platform: /tmp on Mac/Linux, %TEMP% on Windows
]

logger = logging.getLogger("whattONE.engine")

def is_safe_path(file_path):
    """Check if file path is within allowed directories"""
    abs_path = os.path.abspath(file_path)
    return any(abs_path.startswith(d) for d in ALLOWED_UPLOAD_DIRS)

def validate_phone(phone):
    """Validate phone number format"""
    arabic_map = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
    clean = str(phone).strip().translate(arabic_map)
    clean = clean.replace('+', '').replace(' ', '').replace('-', '')
    return bool(re.match(r'^\d{8,15}$', clean))

def normalize_phone(phone):
    """Normalize phone to international format (Saudi numbers)"""
    arabic_map = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
    p = str(phone).strip().translate(arabic_map)
    p = p.replace('+', '').replace(' ', '').replace('-', '')
    if p.startswith('05') and len(p) == 10: p = '966' + p[1:]
    elif p.startswith('5') and len(p) == 9: p = '966' + p
    return p

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


class WhatsAppEngine:
    """
    Advanced WhatsApp Automation Engine for whattONE.
    Features: Human typing simulation, Activity jitter, Anti-detection, and Session persistence.
    """
    def __init__(self, csv_path, file_lock=None):
        self.csv_path = csv_path
        self.file_lock = file_lock or threading.Lock()
        self.driver = None
        self.wait = None
        self.running = False
        self.message_count = 0
        self.refresh_threshold = random.randint(15, 25)
        self.stats = {
            "sent": 0,
            "failed": 0,
            "skipped": 0,
            "total": 0,
            "start_time": None
        }
        self.last_activity_time = time.time()

    def stop(self):
        """Stop the current mission"""
        self.running = False
        logger.info("⏹ Stopping WhattONE Engine...")

    def get_stats(self):
        """Get current statistics"""
        return {**self.stats}

    def _human_typing(self, element, text):
        """Simulate natural human typing with bursts and pauses"""
        try:
            element.click()
            time.sleep(random.uniform(0.5, 1.2)) # Pause to show "typing..." indicator
            
            # If message is very long, paste it to save time, but act human
            if len(text) > 150:
                self._paste_message(element, text)
                return

            words = text.split(' ')
            for i, word in enumerate(words):
                for char in word:
                    element.send_keys(char)
                    time.sleep(random.uniform(0.01, 0.08)) # Quick keystrokes
                    if random.random() < 0.005: # Occasional typo
                        element.send_keys(Keys.BACKSPACE)
                        time.sleep(random.uniform(0.1, 0.2))
                        element.send_keys(char)
                
                if i < len(words) - 1:
                    element.send_keys(' ')
                    time.sleep(random.uniform(0.03, 0.1))
                
                if word.endswith('.') or word.endswith('!') or word.endswith('؟'):
                    time.sleep(random.uniform(0.2, 0.5))
        except Exception as e:
            logger.warning(f"Typing error, falling back: {e}")
            element.send_keys(text)

    def _paste_message(self, input_box, text):
        """Paste full message using JavaScript to preserve formatting and look human-ish"""
        try:
            input_box.click()
            time.sleep(0.3)
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
            time.sleep(0.5)
        except Exception:
            self._human_typing(input_box, text)

    def _simulate_human_activity(self):
        """Random movements and scrolls"""
        if not self.driver: return
        try:
            actions = ActionChains(self.driver)
            actions.move_by_offset(random.randint(-30, 30), random.randint(-30, 30)).perform()
            time.sleep(random.uniform(0.5, 1.2))
            scroll = random.randint(50, 200)
            self.driver.execute_script(f"window.scrollBy(0, {scroll});")
            time.sleep(random.uniform(0.3, 0.7))
            self.driver.execute_script(f"window.scrollBy(0, -{scroll});")
        except Exception:
            pass

    def _cleanup_session_locks(self):
        """Clean up session locks to prevent 'Profile in use' errors"""
        lock_files = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
        for lf in lock_files:
            path = os.path.join(SESSION_DIR, lf)
            if os.path.exists(path) or os.path.islink(path):
                try:
                    os.remove(path)
                except OSError:
                    pass

    def _build_chrome_options(self):
        """Chrome configuration for anti-detection"""
        options = Options()
        options.add_argument(f"--user-data-dir={SESSION_DIR}")
        options.add_argument("--profile-directory=Default")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-gpu")
        options.add_argument("--remote-debugging-port=0")
        options.add_argument("--disable-infobars")
        options.add_argument("--disable-notifications")
        _w = 1280 + random.randint(-80, 80)
        _h = 800 + random.randint(-60, 60)
        options.add_argument(f"--window-size={_w},{_h}")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option('useAutomationExtension', False)
        options.add_argument(f"--user-agent={_get_user_agent()}")
        return options

    def init_browser(self):
        """Initialize browser with robust logic"""
        logger.info("🔧 Initializing whattONE Engine...")
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self._cleanup_session_locks()
                options = self._build_chrome_options()
                service = Service(ChromeDriverManager().install())
                self.driver = webdriver.Chrome(service=service, options=options)
                # Hide navigator.webdriver PERMANENTLY (survives page navigations)
                self.driver.execute_cdp_cmd(
                    "Page.addScriptToEvaluateOnNewDocument",
                    {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"}
                )
                # Hide additional automation fingerprints
                self.driver.execute_cdp_cmd(
                    "Page.addScriptToEvaluateOnNewDocument",
                    {"source": """
                        Object.defineProperty(navigator, 'plugins', {
                            get: () => [1, 2, 3, 4, 5]
                        });
                        Object.defineProperty(navigator, 'languages', {
                            get: () => ['ar', 'ar-SA', 'en-US', 'en']
                        });
                        window.chrome = { runtime: {} };
                        const origQuery = window.navigator.permissions.query;
                        window.navigator.permissions.query = (params) =>
                            params.name === 'notifications'
                                ? Promise.resolve({state: Notification.permission})
                                : origQuery(params);
                    """}
                )
                self.wait = WebDriverWait(self.driver, 60)
                logger.info("✅ Engine ready.")
                return True
            except Exception as e:
                logger.error(f"Attempt {attempt + 1} failed: {e}")
                if self.driver: 
                    try: self.driver.quit() 
                    except: pass
                time.sleep(3)
        return False

    def check_login(self):
        """Navigate and check login"""
        self.driver.get("https://web.whatsapp.com")
        logger.info("📱 Waiting for login...")
        try:
            self.wait.until(EC.presence_of_element_located((By.XPATH, '//div[@id="side"] | //div[@id="main"]')))
            logger.info("✅ Login successful.")
            return True
        except TimeoutException:
            return False

    def run_mission(self, batch_size=5, min_delay=20, max_delay=45, long_break=300, continuous=False):
        """Main execution loop"""
        logger.info("🚀 Starting mission...")
        self.running = True
        self.stats["start_time"] = datetime.now().isoformat()

        # Human warm-up: browse briefly before starting
        warmup = random.uniform(15, 45)
        logger.info(f"🧘 Human warm-up: browsing for {int(warmup)}s before starting…")
        time.sleep(warmup)

        try:
            while self.running:
                df = self._read_queue()
                if df is None or df.empty:
                    if continuous:
                        time.sleep(5)
                        continue
                    break

                pending = df[df['status'].isna() | (df['status'] == 'pending') | (df['status'] == '')]
                self.stats["total"] = len(df)

                if pending.empty:
                    if continuous:
                        time.sleep(10)
                        continue
                    break

                logger.info(f"📨 {len(pending)} pending messages.")

                for i, (index, row) in enumerate(pending.iterrows()):
                    if not self.running: break
                    
                    if self.message_count > 0 and self.message_count % self.refresh_threshold == 0:
                        logger.info("🔄 Refreshing to maintain performance...")
                        try:
                            self.driver.refresh()
                            time.sleep(random.uniform(8, 15))
                            if not self.check_login():
                                logger.error("❌ Session lost after refresh — stopping.")
                                self.running = False
                                break
                        except WebDriverException as refresh_err:
                            logger.error(f"Browser error after refresh: {refresh_err}")
                            self.running = False
                            break

                    status = self._send_single_message(row, i + 1, len(pending))
                    self.message_count += 1
                    self.last_activity_time = time.time()
                    
                    if status == 'sent': self.stats["sent"] += 1
                    elif status == 'failed': self.stats["failed"] += 1
                    else: self.stats["skipped"] += 1

                    if (i + 1) % batch_size == 0 and (i + 1) < len(pending):
                        sleep_time = random.uniform(long_break * 0.8, long_break * 1.2)
                        logger.info(f"☕ Batch break: {int(sleep_time)}s")
                        time.sleep(sleep_time)
                    else:
                        time.sleep(random.uniform(min_delay, max_delay))

        except Exception as e:
            logger.error(f"💥 Mission failed: {e}")
        finally:
            if self.driver:
                self.driver.quit()
                logger.info("🔒 Closed safely.")

    def _read_queue(self):
        try:
            if not os.path.exists(self.csv_path): return None
            with self.file_lock:
                return pd.read_csv(self.csv_path, dtype=object)
        except Exception:
            return None

    def _open_chat_human_like(self, phone):
        """فتح المحادثة عبر واجهة المستخدم لمحاكاة البشر ومنع إعادة تحميل الصفحة"""
        try:
            # النقر على أيقونة محادثة جديدة
            try:
                new_chat_btn = self.wait.until(EC.element_to_be_clickable((By.XPATH, '//div[@title="New chat"] | //span[@data-icon="new-chat-outline"] | //span[@data-icon="chat"]')))
                new_chat_btn.click()
                time.sleep(1)
            except TimeoutException:
                pass # قد نكون بالفعل في شاشة تسمح بالبحث

            # البحث عن مربع البحث
            search_box = self.wait.until(EC.presence_of_element_located((By.XPATH, '//div[@contenteditable="true"][@data-tab="3"] | //div[@id="side"]//div[@contenteditable="true"]')))
            search_box.click()
            
            # مسح المربع
            _mod_key = Keys.COMMAND if PLATFORM == 'Darwin' else Keys.CONTROL
            ActionChains(self.driver).key_down(_mod_key).send_keys('a').key_up(_mod_key).send_keys(Keys.BACKSPACE).perform()
            time.sleep(0.5)
            
            # كتابة الرقم ببطء كالبشر
            for char in phone:
                search_box.send_keys(char)
                time.sleep(random.uniform(0.05, 0.15))
            
            # انتظار ظهور النتائج من الخادم
            time.sleep(random.uniform(2.0, 3.5))
            
            # محاولة ضغط إنتر لفتح المحادثة مباشرة
            search_box.send_keys(Keys.ENTER)
            time.sleep(1.5)
            
            # التحقق من أن المحادثة فُتحت
            try:
                self.driver.find_element(By.XPATH, '//div[@contenteditable="true"][@data-tab="10"] | //footer//div[@contenteditable="true"]')
                return True
            except NoSuchElementException:
                # إذا لم تُفتح، البحث عن الرقم في القائمة والنقر عليه
                try:
                    contact = self.driver.find_element(By.XPATH, f'//span[contains(@title, "{phone}")] | //span[contains(text(), "{phone}")] | //div[@role="button"]//span[contains(text(), "{phone}")]')
                    contact.click()
                    time.sleep(1.5)
                    return True
                except NoSuchElementException:
                    # تفريغ المربع والخروج إذا لم يوجد
                    _mod_key = Keys.COMMAND if PLATFORM == 'Darwin' else Keys.CONTROL
                    ActionChains(self.driver).key_down(_mod_key).send_keys('a').key_up(_mod_key).send_keys(Keys.BACKSPACE).send_keys(Keys.ESCAPE).perform()
                    return False
        except Exception as e:
            logger.error(f"UI Search failed for {phone}: {e}")
            return False

    def _send_single_message(self, row, current, total):
        try:
            phone = normalize_phone(row['phone'])
            message = str(row.get('message', '')).strip()
            msg_id = row.get('id', f'msg_{current}')

            if not message:
                self._update_status(msg_id, 'skipped')
                return 'skipped'

            if not validate_phone(phone):
                self._update_status(msg_id, 'invalid_phone')
                return 'skipped'

            logger.info(f"[{current}/{total}] → {phone}")
            
            # 1. محاولة فتح المحادثة كالبشر دون إعادة تحميل
            chat_opened = self._open_chat_human_like(phone)
            
            # 2. خطة بديلة (Fallback) إذا فشل البحث في الواجهة
            if not chat_opened:
                logger.warning(f"البحث بالواجهة فشل لـ {phone}، تجربة الرابط المباشر (سيتم إعادة تحميل الصفحة)...")
                self.driver.get(f"https://web.whatsapp.com/send?phone={phone}")
                try:
                    self.wait.until(EC.presence_of_element_located((By.XPATH, 
                        '//div[@contenteditable="true"][@data-tab="10"] | //div[contains(text(), "invalid")]'
                    )))
                except TimeoutException:
                    self._update_status(msg_id, 'failed')
                    return 'failed'

            if self.driver.find_elements(By.XPATH, '//div[contains(text(), "invalid")]'):
                self._update_status(msg_id, 'invalid_phone')
                return 'skipped'

            time.sleep(random.uniform(1.0, 2.5))
            self._simulate_human_activity()

            attachment = row.get('attachment')
            if attachment and pd.notna(attachment) and str(attachment).strip():
                self._send_attachment(str(attachment).strip())
                time.sleep(2)

            input_box = self.driver.find_element(By.XPATH, '//div[@contenteditable="true"][@data-tab="10"] | //footer//div[@contenteditable="true"]')
            self._human_typing(input_box, message)
            time.sleep(1)
            input_box.send_keys(Keys.ENTER)
            
            time.sleep(2)
            self._update_status(msg_id, 'sent')
            return 'sent'

        except Exception as e:
            logger.error(f"Error sending to {phone}: {e}")
            self._update_status(msg_id, 'failed')
            return 'failed'

    def _send_attachment(self, file_path):
        if not os.path.exists(file_path) or not is_safe_path(file_path):
            return
        try:
            attach_btn = self.wait.until(EC.element_to_be_clickable((By.XPATH, '//span[@data-icon="plus"] | //span[@data-icon="clip"]')))
            attach_btn.click()
            time.sleep(1)
            file_input = self.driver.find_element(By.XPATH, '//input[@type="file"]')
            file_input.send_keys(os.path.abspath(file_path))
            send_btn = self.wait.until(EC.element_to_be_clickable((By.XPATH, '//span[@data-icon="send"] | //div[@role="button"][@aria-label="Send"]')))
            time.sleep(1)
            send_btn.click()
        except Exception:
            ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()

    def _update_status(self, msg_id, status):
        """Update message status in CSV in a thread-safe manner"""
        if not msg_id: return
        try:
            with self.file_lock:
                if os.path.exists(self.csv_path):
                    df = pd.read_csv(self.csv_path, dtype=object)
                    if 'id' in df.columns:
                        df.loc[df['id'] == str(msg_id), 'status'] = status
                        df.to_csv(self.csv_path, index=False)
        except Exception as e:
            logger.error(f"Failed to update CSV status: {e}")
