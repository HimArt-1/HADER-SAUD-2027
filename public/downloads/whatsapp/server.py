from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context, Blueprint
from flask_cors import CORS
from functools import wraps
import threading
import logging
import os
import sys
import secrets
import time
import glob
import html
import re
import json
import queue as queue_module
from datetime import datetime, timedelta
from collections import defaultdict, deque
from whatsapp_pro_tool import WhatsAppProTool
from engine_controller import EngineController, sanitize_mission_options
from PIL import Image, ImageDraw, ImageFont
import random

# App Setup
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

VERSION = "3.0.0"

app = Flask(__name__)
PORT = int(os.environ.get('WHATSAPP_SERVER_PORT', 5001))
HOST = os.environ.get('WHATSAPP_SERVER_HOST', '0.0.0.0').strip() or '0.0.0.0'

# ═══════════════════════════════════════════════════════════════
# 🔐 إعدادات الأمان
# ═══════════════════════════════════════════════════════════════

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "https://hader-saud-2027.vercel.app",
]
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS, "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"], "allow_headers": ["Content-Type", "X-API-Key", "Cache-Control"]}})

# إنشاء Blueprint للتعامل مع بادئة /api
api_bp = Blueprint('api', __name__)

# تسجيل الـ Blueprint سيتم في نهاية الملف بعد تعريف المسارات

# مفتاح API للمصادقة (يجب تعيينه في متغيرات البيئة)
API_SECRET_KEY = (os.environ.get('WHATSAPP_API_KEY') or '').strip() or None

# أنواع الملفات المسموح بها
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def _env_bool(name: str, default: bool = False) -> bool:
    raw = (os.environ.get(name) or '').strip().lower()
    if not raw:
        return default
    return raw in {'1', 'true', 'yes', 'on'}


def _env_number(name: str, default):
    raw = (os.environ.get(name) or '').strip()
    if not raw:
        return default
    try:
        return type(default)(float(raw)) if isinstance(default, int) else float(raw)
    except ValueError:
        return default


# ⚙️ إعدادات المحرك (قابلة للضبط من متغيرات البيئة)
LOGIN_TIMEOUT_SECONDS = _env_number('WHATSAPP_LOGIN_TIMEOUT', 15 * 60)
AUTO_SEND_ON_START = _env_bool('WHATSAPP_AUTO_SEND_ON_START', False)
MISSION_DEFAULTS = sanitize_mission_options({
    'batch_size': os.environ.get('WHATSAPP_BATCH_SIZE'),
    'min_delay': os.environ.get('WHATSAPP_MIN_DELAY'),
    'max_delay': os.environ.get('WHATSAPP_MAX_DELAY'),
    'long_break': os.environ.get('WHATSAPP_LONG_BREAK'),
    'continuous': _env_bool('WHATSAPP_CONTINUOUS', False),
})

# ═══════════════════════════════════════════════════════════════
# 🛡️ Rate Limiting - حماية من الطلبات المتكررة
# ═══════════════════════════════════════════════════════════════

class RateLimiter:
    """محدد معدل الطلبات - يحمي من إغراق الخادم"""
    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self.lock = threading.Lock()
    
    def is_allowed(self, client_ip: str) -> bool:
        """التحقق من السماح بالطلب"""
        with self.lock:
            now = time.time()
            # تنظيف الطلبات القديمة
            self.requests[client_ip] = [
                req_time for req_time in self.requests[client_ip]
                if now - req_time < self.window_seconds
            ]
            
            if len(self.requests[client_ip]) >= self.max_requests:
                return False
            
            self.requests[client_ip].append(now)
            return True
    
    def get_remaining(self, client_ip: str) -> int:
        """الحصول على عدد الطلبات المتبقية"""
        with self.lock:
            now = time.time()
            valid_requests = [
                req_time for req_time in self.requests[client_ip]
                if now - req_time < self.window_seconds
            ]
            return max(0, self.max_requests - len(valid_requests))

# Rate limiters لمختلف العمليات
general_limiter = RateLimiter(max_requests=100, window_seconds=60)  # 100 طلب/دقيقة
send_limiter = RateLimiter(max_requests=30, window_seconds=60)  # 30 إرسال/دقيقة
upload_limiter = RateLimiter(max_requests=20, window_seconds=60)  # 20 رفع/دقيقة

def rate_limit(limiter: RateLimiter):
    """Decorator للتحقق من معدل الطلبات"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client_ip = request.remote_addr or 'unknown'
            if not limiter.is_allowed(client_ip):
                remaining = limiter.get_remaining(client_ip)
                return jsonify({
                    "error": "تم تجاوز الحد الأقصى للطلبات. يرجى الانتظار.",
                    "remaining": remaining,
                    "retry_after": limiter.window_seconds
                }), 429
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def allowed_file(filename):
    """التحقق من أن الملف من الأنواع المسموحة"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def require_api_key(f):
    """Decorator للتحقق من مفتاح API"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # نسمح دون مفتاح لتسهيل الاستخدام
        if not API_SECRET_KEY:
            return f(*args, **kwargs)
        
        # التحقق من المفتاح في الـ header
        provided_key = request.headers.get('X-API-Key')
        if not provided_key or not secrets.compare_digest(provided_key, API_SECRET_KEY):
            return jsonify({"error": "غير مصرح - مفتاح API غير صالح"}), 401
        return f(*args, **kwargs)
    return decorated_function


def is_loopback_host(value: str) -> bool:
    return value in {'127.0.0.1', '::1', 'localhost'}


def is_api_key_required() -> bool:
    return API_SECRET_KEY is not None or not is_loopback_host(HOST)

# ═══════════════════════════════════════════════════════════════
# 🧹 تنظيف الملفات القديمة
# ═══════════════════════════════════════════════════════════════

def cleanup_old_files():
    """حذف المرفقات والشهادات القديمة (أكثر من 24 ساعة)"""
    try:
        upload_folder = os.path.join(os.path.dirname(__file__), 'uploads')
        cert_folder = os.path.join(os.path.dirname(__file__), 'certificates')
        
        cutoff_time = datetime.now() - timedelta(hours=24)
        deleted_count = 0
        
        for folder in [upload_folder, cert_folder]:
            if not os.path.exists(folder):
                continue
            
            for file_path in glob.glob(os.path.join(folder, '*')):
                if os.path.isfile(file_path):
                    file_mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                    if file_mtime < cutoff_time:
                        try:
                            os.remove(file_path)
                            deleted_count += 1
                        except OSError as e:
                            logging.warning(f"فشل حذف الملف {file_path}: {e}")
        
        if deleted_count > 0:
            logging.info(f"تم تنظيف {deleted_count} ملف قديم")
        
        return deleted_count
    except Exception as e:
        logging.error(f"خطأ في تنظيف الملفات: {e}")
        return 0

def start_cleanup_scheduler():
    """بدء جدولة التنظيف التلقائي كل ساعة"""
    def cleanup_task():
        while True:
            time.sleep(3600)  # انتظار ساعة
            cleanup_old_files()
    
    cleanup_thread = threading.Thread(target=cleanup_task, daemon=True)
    cleanup_thread.start()
    logging.info("تم بدء جدولة التنظيف التلقائي للملفات")

# إعداد السجلات
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

# فلتر لمنع تسجيل طلبات OPTIONS (CORS preflight) التي تسبب فيضان في اللوغ
class OptionsFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return 'OPTIONS' not in msg


class RingBufferLogHandler(logging.Handler):
    """يحتفظ بآخر السجلات في الذاكرة لعرضها في لوحة التحكم (System Logs)."""
    def __init__(self, capacity: int = 150):
        super().__init__(level=logging.INFO)
        self._records = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def emit(self, record):
        try:
            line = self.format(record)
        except Exception:
            return
        with self._lock:
            self._records.append(line)

    def tail(self, count: int = 60):
        with self._lock:
            items = list(self._records)
        return items[-count:] if count else items


class NoiseFilter(logging.Filter):
    """يمنع سجلات HTTP الروتينية (werkzeug) من إغراق سجل لوحة التحكم — تبقى سجلات المحرك فقط."""
    _NOISY = ('GET /api/status', 'GET /status', 'GET /api/queue', 'GET /queue', 'GET /api/events', 'GET /events', 'OPTIONS')

    def filter(self, record):
        if record.name.startswith('werkzeug'):
            return False
        msg = record.getMessage()
        return not any(token in msg for token in self._NOISY)


# مسح المعالجات المكررة (whatsapp_pro_tool يضيف handlers أيضاً)
logging.root.handlers.clear()

# معالج الملف
file_handler = logging.FileHandler(os.path.join(LOG_DIR, "server.log"), encoding='utf-8')
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
file_handler.addFilter(OptionsFilter())
logging.root.addHandler(file_handler)

# معالج الطرفية
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
console_handler.addFilter(OptionsFilter())
logging.root.addHandler(console_handler)

# معالج لوحة التحكم (آخر السجلات في الذاكرة)
dashboard_log_handler = RingBufferLogHandler(capacity=150)
dashboard_log_handler.setFormatter(logging.Formatter('%(asctime)s %(message)s', datefmt='%H:%M:%S'))
dashboard_log_handler.addFilter(NoiseFilter())
logging.root.addHandler(dashboard_log_handler)

logging.root.setLevel(logging.INFO)

logging.info(f"Server starting with Python: {sys.executable}")

# المتغيرات العامة
file_lock = threading.Lock()

# ═══════════════════════════════════════════════════════════════
# 📡 SSE — Server-Sent Events Registry
# ═══════════════════════════════════════════════════════════════

_sse_clients: list = []
_sse_lock = threading.Lock()


def sse_broadcast(event_type: str, data: dict) -> None:
    payload = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    with _sse_lock:
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(payload)
            except queue_module.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


# إعداد قاعدة البيانات SQLite بدلاً من CSV
import sqlite_db
CERT_DIR = os.path.join(os.path.dirname(__file__), "certificates")
if not os.path.exists(CERT_DIR):
    os.makedirs(CERT_DIR)

logging.info(f"Configuration: SQLITE_DB_INITIALIZED")
logging.info(f"Configuration: CERT_DIR={CERT_DIR}")
logging.info(f"Configuration: UPLOAD_DIR={os.path.join(os.path.dirname(__file__), 'uploads')}")


# ═══════════════════════════════════════════════════════════════
# 🧭 محرك واتساب — دورة حياة على مرحلتين
#   "تشغيل المحرك"  → فتح واتساب ويب وانتظار تسجيل الدخول (حالة ready)
#   "إبدأ الإرسال"  → إظهار النافذة وإرسال الطابور (حالة sending)
# ═══════════════════════════════════════════════════════════════

def _pending_count() -> int:
    try:
        with file_lock:
            return sqlite_db.count_pending()
    except Exception:
        return 0


def _engine_payload(snapshot: dict = None, log_lines: int = 40) -> dict:
    """الحالة الكاملة للمحرك كما تراها لوحة التحكم (REST + SSE)."""
    snap = dict(snapshot or engine.snapshot())
    snap['pending'] = _pending_count()
    snap['version'] = VERSION
    snap['logs'] = dashboard_log_handler.tail(log_lines)
    return snap


def _sse_current_snapshot(snapshot: dict = None) -> dict:
    return _engine_payload(snapshot, log_lines=40)


def _on_engine_change(snapshot: dict) -> None:
    try:
        sse_broadcast('status', _sse_current_snapshot(snapshot))
    except Exception as exc:  # pragma: no cover - broadcasting must never break the engine
        logging.debug(f"SSE broadcast failed: {exc}")


def _make_bot() -> WhatsAppProTool:
    # WhatsAppProTool expects the SQLite db path
    return WhatsAppProTool(sqlite_db.DB_FILE, file_lock)


engine = EngineController(
    _make_bot,
    on_change=_on_engine_change,
    login_timeout=LOGIN_TIMEOUT_SECONDS,
    mission_defaults=MISSION_DEFAULTS,
)


def _broadcast_queue_change(action: str, added: int = 0) -> None:
    sse_broadcast('queue_update', {"action": action, "added": added})
    sse_broadcast('status', _sse_current_snapshot())


def _control_response(ok: bool, message: str, code: int):
    payload = {"message": message, "ok": ok}
    payload.update(_engine_payload(log_lines=0))
    payload.pop('logs', None)
    return jsonify(payload), (code if not ok else (code if code in (200, 202) else 200))


def _request_options() -> dict:
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return {}
    options = body.get('options')
    if isinstance(options, dict):
        return options
    return body


def generate_certificate(student_name, cert_type='appreciation'):
    """-توليد شهادة بصرية للطالب"""
    try:
        logging.info(f"Generating certificate for {student_name} ({cert_type})")
        width, height = 1200, 800
        # ألوان الخلفية حسب النوع
        if cert_type == 'gold':
            bg_color = (255, 215, 0) # Gold
            border_color = (184, 134, 11)
            title_text = "نجم الأسبوع"
        elif cert_type == 'silver':
            bg_color = (192, 192, 192) # Silver
            border_color = (105, 105, 105)
            title_text = "جهد متميز"
        else:
            bg_color = (255, 248, 220) # Cornsilk (Bronze/Paper)
            border_color = (139, 69, 19)
            title_text = "شكر وتقدير"

        # إنشاء الصورة
        img = Image.new('RGB', (width, height), color=(255, 255, 255))
        d = ImageDraw.Draw(img)

        # رسم إطار
        d.rectangle([20, 20, width-20, height-20], outline=border_color, width=10)
        d.rectangle([40, 40, width-40, height-40], outline=bg_color, width=5)
        
        # رسم خلفية خفيفة
        d.rectangle([50, 50, width-50, height-50], fill=bg_color)
        
        # محاولة تحميل خط عربي (دعم أنظمة تشغيل متعددة)
        font_path = None
        
        # قائمة المسارات المحتملة للخطوط العربية (Masterful Cross-platform detection)
        font_candidates = [
            # macOS
            "/System/Library/Fonts/GeezaPro.ttc",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/Arabic/GeezaPro.ttc",
            # Windows
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/tahoma.ttf",
            "C:/Windows/Fonts/times.ttf",
            "C:/Windows/Fonts/calibri.ttf",
            # Linux (Universal)
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.otf",
            # Local Custom Font
            os.path.join(os.path.dirname(__file__), "fonts", "arabic.ttf"),
            os.path.join(os.path.dirname(__file__), "arabic.ttf"),
        ]
        
        for candidate in font_candidates:
            if os.path.exists(candidate):
                font_path = candidate
                break
        
        try:
            if font_path:
                title_font = ImageFont.truetype(font_path, 80)
                name_font = ImageFont.truetype(font_path, 120)
                msg_font = ImageFont.truetype(font_path, 40)
                logging.debug(f"تم تحميل الخط: {font_path}")
            else:
                raise IOError("لم يتم العثور على خط مناسب")
        except (IOError, OSError) as e:
            logging.warning(f"فشل تحميل الخط ({font_path}): {e}, استخدام الخط الافتراضي")
            title_font = ImageFont.load_default()
            name_font = ImageFont.load_default()
            msg_font = ImageFont.load_default()

        # رسم النصوص (تمركز)
        # Title
        d.text((width/2, 150), title_text, font=title_font, fill=border_color, anchor="mm")
        
        # Name
        d.text((width/2, 400), student_name, font=name_font, fill=(0, 0, 0), anchor="mm")
        
        # Footer
        d.text((width/2, 600), "تتقدم إدارة المدرسة بالشكر والتقدير للطالب", font=msg_font, fill=(50, 50, 50), anchor="mm")
        d.text((width/2, 660), "على تميزه وانضباطه", font=msg_font, fill=(50, 50, 50), anchor="mm")

        # حفظ الملف
        filename = f"cert_{cert_type}_{random.randint(1000,9999)}.png"
        filepath = os.path.join(CERT_DIR, filename)
        img.save(filepath)
        logging.info(f"Certificate saved at: {filepath}")
        return filepath
        
    except Exception as e:
        import traceback
        logging.error(f"فشل توليد الشهادة: {e}")
        logging.error(traceback.format_exc())
        return None

def watchdog_task():
    """نظام Watchdog لإعادة تشغيل المتصفح في حال التجمد أثناء الإرسال"""
    while True:
        time.sleep(30)
        try:
            engine.watchdog_check(max_idle_seconds=300)
        except Exception as e:
            logging.error(f"Watchdog error: {e}")

watchdog_thread = threading.Thread(target=watchdog_task, daemon=True)
watchdog_thread.start()

@api_bp.route('/', methods=['GET'])
@rate_limit(general_limiter)
def index():
    """رسالة ترحيبية عند زيارة الصفحة الرئيسية"""
    return jsonify({
        "status": "online",
        "message": "WhatsApp Control Server is Running. Use /status, /start, /sending/start, /stop endpoints.",
        "version": VERSION,
        "features": ["rate_limiting", "auto_cleanup", "secure_ids", "two_phase_engine", "window_focus", "pause_resume", "sse"]
    })

@api_bp.route('/favicon.ico')
def favicon():
    return '', 204

@api_bp.route('/status', methods=['GET'])
# بدون rate limit - نقطة فحص الاتصال
@require_api_key
def status():
    """حالة المحرك الكاملة: running (المتصفح مفتوح) / logged_in / sending / paused / progress / logs"""
    return jsonify(_engine_payload(log_lines=80))

@api_bp.route('/start', methods=['POST'])
@require_api_key
def start():
    """
    تشغيل المحرك: فتح Chrome + واتساب ويب وانتظار تسجيل الدخول.
    لا يبدأ الإرسال تلقائياً (إلا مع auto_send=true).
    """
    body = request.get_json(silent=True) or {}
    auto_send = AUTO_SEND_ON_START
    if isinstance(body, dict) and 'auto_send' in body:
        auto_send = bool(body.get('auto_send'))
    ok, message, code = engine.start_engine(auto_send=auto_send, options=_request_options())
    if ok:
        logging.info("▶️  تم بدء تشغيل المحرك بواسطة API")
    return _control_response(ok, message, code)

@api_bp.route('/stop', methods=['POST'])
@require_api_key
def stop():
    """إيقاف اضطراري: إيقاف الإرسال وإغلاق المتصفح"""
    ok, message, code = engine.stop_engine()
    if ok:
        logging.info("⏹  تم إيقاف المحرك بواسطة API")
    return _control_response(ok, message, code)

@api_bp.route('/sending/start', methods=['POST'])
@require_api_key
def sending_start():
    """إبدأ الإرسال: إظهار آخر نافذة واتساب ويب ثم إرسال الرسائل المعلقة في الطابور"""
    ok, message, code = engine.start_sending(options=_request_options())
    if ok:
        logging.info("📤 بدء الإرسال بواسطة API")
    return _control_response(ok, message, code)

@api_bp.route('/sending/pause', methods=['POST'])
@require_api_key
def sending_pause():
    ok, message, code = engine.pause_sending()
    return _control_response(ok, message, code)

@api_bp.route('/sending/resume', methods=['POST'])
@require_api_key
def sending_resume():
    ok, message, code = engine.resume_sending()
    return _control_response(ok, message, code)

@api_bp.route('/sending/stop', methods=['POST'])
@require_api_key
def sending_stop():
    """إيقاف الإرسال مع إبقاء نافذة واتساب مفتوحة (العودة إلى ready)"""
    ok, message, code = engine.stop_sending()
    return _control_response(ok, message, code)

@api_bp.route('/window/focus', methods=['POST'])
@require_api_key
def window_focus():
    """إظهار آخر نافذة واتساب ويب في المقدمة"""
    ok, message, code = engine.focus_window()
    return _control_response(ok, message, code)

@api_bp.route('/certificates/<path:filename>')
@require_api_key
def serve_certificate(filename):
    """خدمة ملفات الشهادات"""
    return send_from_directory(CERT_DIR, filename)

@api_bp.route('/badges/latest', methods=['GET'])
@require_api_key
def get_latest_badges():
    """الحصول على أحدث الشهادات للعرض في الكشك"""
    try:
        # Get list of files in CERT_DIR
        files = []
        if os.path.exists(CERT_DIR):
            for f in os.listdir(CERT_DIR):
                if f.endswith(('.png', '.jpg', '.jpeg')) and f.startswith('cert_'):
                    path = os.path.join(CERT_DIR, f)
                    if os.path.isfile(path):
                        files.append({
                            'filename': f,
                            'url': f"/certificates/{f}",
                            'time': os.path.getmtime(path)
                        })
        
        # Sort by time, newest first
        files.sort(key=lambda x: x['time'], reverse=True)
        
        # Return top 20
        return jsonify(files[:20])
    except Exception as e:
        logging.error(f"Error fetching badges: {e}")
        return jsonify([])

@api_bp.route('/upload', methods=['POST'])
@rate_limit(upload_limiter)
@require_api_key
def upload_file():
    """رفع ملف (صورة/PDF) لاستخدامه في الإرسال مع التحقق الأمني"""
    try:
        if 'file' not in request.files:
            return jsonify({"message": "لم يتم إرفاق ملف"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"message": "اسم الملف فارغ"}), 400

        # التحقق من نوع الملف
        if not allowed_file(file.filename):
            return jsonify({
                "message": f"نوع الملف غير مسموح. الأنواع المسموحة: {', '.join(ALLOWED_EXTENSIONS)}"
            }), 400
        
        # التحقق من حجم الملف
        file.seek(0, 2)  # الذهاب لنهاية الملف
        file_size = file.tell()
        file.seek(0)  # العودة للبداية
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({
                "message": f"حجم الملف كبير جداً. الحد الأقصى: {MAX_FILE_SIZE // (1024*1024)} MB"
            }), 400

        # التحقق من محتوى الملف (MIME type)
        import mimetypes
        mime_type, _ = mimetypes.guess_type(file.filename)
        allowed_mimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']
        if mime_type and mime_type not in allowed_mimes:
            return jsonify({"message": "نوع محتوى الملف غير مسموح"}), 400

        import werkzeug
        # تنظيف اسم الملف
        original_filename = werkzeug.utils.secure_filename(file.filename)
        # إضافة timestamp لتجنب التعارض
        timestamp = int(time.time())
        filename = f"{timestamp}_{original_filename}"
        
        upload_folder = os.path.join(os.path.dirname(__file__), 'uploads')
        if not os.path.exists(upload_folder):
            os.makedirs(upload_folder)
            
        file_path = os.path.join(upload_folder, filename)
        file.save(file_path)
        
        logging.info(f"تم رفع ملف بنجاح: {filename} (الحجم: {file_size} bytes)")
        return jsonify({"path": file_path, "message": "تم رفع الملف بنجاح"})
        
    except Exception as e:
        logging.error(f"خطأ في رفع الملف: {e}")
        return jsonify({"message": "فشل رفع الملف"}), 500

@api_bp.route('/queue', methods=['GET'])
# بدون rate limit - قراءة فقط
@require_api_key
def get_queue():
    """عرض الطابور الحالي"""
    try:
        with file_lock:
            items = sqlite_db.get_queue()
            return jsonify(items)
    except Exception as e:
        return jsonify([])

@api_bp.route('/stats', methods=['GET'])
@require_api_key
def get_stats():
    """إحصائيات طابور الرسائل"""
    try:
        stats = sqlite_db.get_stats()
        return jsonify(stats)
    except Exception as e:
        logging.error(f"خطأ في استرجاع الإحصائيات: {e}")
        return jsonify({"total": 0, "sent": 0, "failed": 0, "pending": 0, "skipped": 0})

@api_bp.route('/delete/<id>', methods=['DELETE'])
@api_bp.route('/queue/<id>', methods=['DELETE'])
@require_api_key
def delete_item(id):
    """حذف عنصر محدد من القائمة"""
    try:
        if not id or len(id) > 100:
            return jsonify({"message": "معرف غير صالح"}), 400
            
        with file_lock:
            success = sqlite_db.delete_item(id)
        if success:
            logging.info(f"تم حذف العنصر: {id}")
            _broadcast_queue_change('remove', 0)
            return jsonify({"message": "تم حذف العنصر بنجاح"})
        else:
            return jsonify({"message": "العنصر غير موجود"}), 404
    except Exception as e:
        logging.error(f"خطأ في حذف العنصر {id}: {e}")
        return jsonify({"message": "فشل حذف العنصر"}), 500

@api_bp.route('/clear', methods=['POST'])
@require_api_key
def clear_queue():
    """مسح قائمة الانتظار"""
    try:
        with file_lock:
            sqlite_db.clear_queue()
        logging.info("تم مسح قائمة الانتظار")
        _broadcast_queue_change('clear', 0)
        return jsonify({"message": "تم مسح القائمة بنجاح"})
    except Exception as e:
        logging.error(f"خطأ في مسح القائمة: {e}")
        return jsonify({"message": "فشل مسح القائمة"}), 500

@api_bp.route('/send', methods=['POST'])
@rate_limit(send_limiter)
@require_api_key
def send_list():
    """استقبال قائمة الإرسال وحفظها في الطابور"""
    try:
        data = request.json
        append_mode = request.args.get('append', 'false').lower() == 'true'

        if not data or not isinstance(data, list):
            return jsonify({"message": "تنسيق البيانات غير صحيح. يجب أن تكون قائمة."}), 400
        
        # حد أقصى لعدد الرسائل
        MAX_BATCH_SIZE = 500
        if len(data) > MAX_BATCH_SIZE:
            return jsonify({"message": f"عدد الرسائل كبير جداً. الحد الأقصى: {MAX_BATCH_SIZE}"}), 400

        # معالجة الشهادات البصرية
        for item in data:
            # التحقق من صحة البيانات
            if 'phone' in item:
                # تنظيف رقم الهاتف (تحويل الأرقام العربية وإزالة الرموز)
                arabic_map = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
                phone_str = str(item.get('phone', '')).translate(arabic_map)
                item['phone'] = ''.join(filter(str.isdigit, phone_str))
            
            if 'certificate_type' in item and item['certificate_type']:
                student_name = item.get('student_name', 'طالب مجتهد')
                # تنظيف اسم الطالب بشكل آمن (إزالة HTML/Script وتحديد الطول)
                student_name = html.escape(str(student_name).strip())[:100]
                # إزالة أي أحرف غير مرئية أو تحكم
                student_name = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', student_name)
                cert_path = generate_certificate(student_name, item['certificate_type'])
                if cert_path:
                    item['attachment'] = cert_path
                    # تحديث الرسالة لتناسب الشهادة
                    if not item.get('message'):
                        item['message'] = f"نهنئ الطالب {student_name} على تميزه."

        # تحويل البيانات وإضافة IDs
        import uuid
        formatted_data = []
        for item in data:
            formatted_item = {
                'id': item.get('id') or str(uuid.uuid4()),
                'phone': item.get('phone', ''),
                'message': item.get('message', ''),
                'attachment': item.get('attachment'),
                'student_name': item.get('student_name', ''),
                'status_label': item.get('status_label', ''),
                'status': item.get('status', 'pending')
            }
            formatted_data.append(formatted_item)

        # Logic for Append vs Overwrite
        with file_lock:
            if append_mode:
                persisted = sqlite_db.append_to_queue(formatted_data)
            else:
                persisted = sqlite_db.overwrite_queue(formatted_data)
        if not persisted:
            return jsonify({"message": "تعذر حفظ الرسائل في قائمة الانتظار"}), 500
                
        logging.info(f"تم تحديث قائمة الإرسال: {len(formatted_data)} جهة اتصال (Append={append_mode}).")
        _broadcast_queue_change('send', len(formatted_data))
        hint = ''
        if engine.state == 'ready':
            hint = ' اضغط "إبدأ الإرسال" لبدء الإرسال.'
        elif not engine.alive:
            hint = ' شغّل المحرك ثم اضغط "إبدأ الإرسال".'
        return jsonify({"message": f"تم حفظ {len(formatted_data)} رسالة في قائمة الانتظار بنجاح.{hint}"})

    except Exception as e:
        logging.error(f"خطأ في حفظ القائمة: {e}")
        return jsonify({"message": "فشل حفظ القائمة"}), 500

# ═══════════════════════════════════════════════════════════════
# 📡 SSE Stream Endpoint
# ═══════════════════════════════════════════════════════════════

@api_bp.route('/events', methods=['GET'])
@require_api_key
def events():
    """
    Server-Sent Events endpoint.
    Events: 'status' (engine state + progress + logs) | 'queue_update' (queue mutations)
    """
    client_q = queue_module.Queue(maxsize=50)

    with _sse_lock:
        _sse_clients.append(client_q)

    def generate():
        try:
            snapshot = _sse_current_snapshot()
            yield f"event: status\ndata: {json.dumps(snapshot, ensure_ascii=False)}\n\n"
        except Exception:
            pass

        try:
            while True:
                try:
                    payload = client_q.get(timeout=30)
                    yield payload
                except queue_module.Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                try:
                    _sse_clients.remove(client_q)
                except ValueError:
                    pass

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        }
    )


# تسجيل الـ Blueprint ببادئة وبدون بادئة للتوافق التام
app.register_blueprint(api_bp, url_prefix='/api')
app.register_blueprint(api_bp, name='api_root')

if __name__ == '__main__':
    print("\n" + "═" * 60)
    print(f"   🚀 HADER WHATSAPP PRO SERVER - [v{VERSION} MASTER]")
    print("═" * 60)
    
    # التأكد من وجود المجلدات المطلوبة
    for folder in ['uploads', 'certificates', 'logs']:
        path = os.path.join(os.path.dirname(__file__), folder)
        if not os.path.exists(path):
            os.makedirs(path)
            print(f"📁 تم إنشاء مجلد: {folder}")
            
    # تشغيل جدولة التنظيف التلقائي
    start_cleanup_scheduler()
    print("✅ جدولة التنظيف التلقائي: مفعّلة (كل 24 ساعة)")
    
    # تنظيف الملفات القديمة عند البدء
    initial_cleanup = cleanup_old_files()
    if initial_cleanup > 0:
        print(f"🧹 تم تنظيف {initial_cleanup} ملف قديم")
    
    # التأكد من تهيئة قاعدة البيانات
    sqlite_db.init_db()
    
    print("⏸️  الخادم في وضع الاستعداد - جاهز لاستقبال الطلبات")
    print("   1) تشغيل المحرك  → يفتح واتساب ويب وينتظر مسح رمز QR")
    print("   2) إبدأ الإرسال  → يُظهر نافذة واتساب ويبدأ إرسال الطابور")
    print("═" * 60)
    print(f"🌐 الرابط المحلي: http://localhost:{PORT}")
    print(f"📊 معدل الحماية: نشط (Rate Limiting Enabled)")
    print("═" * 60 + "\n")
    
    app.run(host=HOST, port=PORT, threaded=True)
