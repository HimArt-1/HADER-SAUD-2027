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
from collections import defaultdict
from whatsapp_pro_tool import WhatsAppProTool
from PIL import Image, ImageDraw, ImageFont
import random

# App Setup
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

app = Flask(__name__)
PORT = int(os.environ.get('WHATSAPP_SERVER_PORT', 5001))
HOST = os.environ.get('WHATSAPP_SERVER_HOST', '0.0.0.0').strip() or '0.0.0.0'

# ═══════════════════════════════════════════════════════════════
# 🔐 إعدادات الأمان
# ═══════════════════════════════════════════════════════════════

CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"], "allow_headers": ["Content-Type", "X-API-Key", "Cache-Control"]}})

# إنشاء Blueprint للتعامل مع بادئة /api
api_bp = Blueprint('api', __name__)

# تسجيل الـ Blueprint سيتم في نهاية الملف بعد تعريف المسارات

# مفتاح API للمصادقة (يجب تعيينه في متغيرات البيئة)
API_SECRET_KEY = (os.environ.get('WHATSAPP_API_KEY') or '').strip() or None

# أنواع الملفات المسموح بها
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

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

# مسح المعالجات المكررة (whatsapp_pro_tool يضيف handlers أيضاً)
logging.root.handlers.clear()

# معالج الملف
file_handler = logging.FileHandler(os.path.join(LOG_DIR, "server.log"))
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

logging.root.setLevel(logging.INFO)

logging.info(f"Server starting with Python: {sys.executable}")

# المتغيرات العامة
bot_instance = None
bot_thread = None
bot_state = 'idle'  # idle | initializing | waiting_login | running | error | stopped
bot_state_message = ''
file_lock = threading.Lock()

# ═══════════════════════════════════════════════════════════════
# 📡 SSE — Server-Sent Events Registry
# ═══════════════════════════════════════════════════════════════

_sse_clients: list = []
_sse_lock = threading.Lock()


def _sse_current_snapshot() -> dict:
    is_running = bot_instance is not None and bot_instance.running
    return {
        "running": is_running,
        "state": bot_state,
        "state_message": bot_state_message,
    }


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
    """نظام Watchdog لإعادة تشغيل المتصفح في حال التجمد"""
    global bot_instance, bot_state, bot_state_message, bot_thread
    while True:
        time.sleep(30)
        try:
            if bot_state == 'running' and bot_instance and bot_instance.running:
                inactive_time = time.time() - bot_instance.last_activity_time
                if inactive_time > 300:
                    logging.error(f"🚨 Watchdog: Browser frozen for {int(inactive_time)}s. Restarting...")
                    bot_state_message = 'المتصفح لا يستجيب - جاري إعادة التشغيل تلقائيا...'
                    bot_state = 'error'
                    sse_broadcast('status', _sse_current_snapshot())
                    
                    bot_instance.running = False
                    try:
                        if hasattr(bot_instance, 'driver') and bot_instance.driver:
                            bot_instance.driver.quit()
                    except Exception:
                        pass
                    
                    bot_instance = None
                    time.sleep(5)
                    
                    bot_thread = threading.Thread(target=run_bot_thread)
                    bot_thread.daemon = True
                    bot_thread.start()
                    logging.info("🚨 Watchdog: Bot restarted.")
        except Exception as e:
            logging.error(f"Watchdog error: {e}")

watchdog_thread = threading.Thread(target=watchdog_task, daemon=True)
watchdog_thread.start()

def run_bot_thread():
    """تشغيل البوت في خيط منفصل مع تتبع الحالة"""
    global bot_instance, bot_state, bot_state_message
    try:
        # DB is checked inside tools/db directly now
        bot_state = 'initializing'
        bot_state_message = 'جاري تهيئة المتصفح...'
        sse_broadcast('status', _sse_current_snapshot())
        
        # WhatsAppProTool now expects the SQLite db path
        bot_instance = WhatsAppProTool(sqlite_db.DB_FILE, file_lock)

        # التحقق من نجاح تهيئة المتصفح
        if not bot_instance.init_browser():
            bot_state = 'error'
            bot_state_message = 'فشل تهيئة المتصفح - تأكد من تثبيت Chrome'
            sse_broadcast('status', _sse_current_snapshot())
            logging.error("فشل تهيئة المتصفح - لن يتم تشغيل البوت")
            return

        bot_state = 'waiting_login'
        bot_state_message = 'بانتظار تسجيل الدخول (مسح QR)...'
        sse_broadcast('status', _sse_current_snapshot())
        if bot_instance.check_login():
            bot_state = 'running'
            bot_state_message = 'البوت يعمل ويرسل الرسائل'
            sse_broadcast('status', _sse_current_snapshot())
            # Optimized settings for human-like behavior and high reliability
            bot_instance.run_mission(
                batch_size=5, 
                min_delay=25, 
                max_delay=60, 
                long_break=180, 
                continuous=True
            )
        else:
            bot_state = 'error'
            bot_state_message = 'فشل تسجيل الدخول - يرجى مسح رمز QR'
            sse_broadcast('status', _sse_current_snapshot())
            logging.error("فشل تسجيل الدخول")

    except Exception as e:
        bot_state = 'error'
        bot_state_message = f'خطأ: {str(e)[:100]}'
        logging.error(f"خطأ في خيط البوت: {e}")
        import traceback
        logging.error(traceback.format_exc())
        sse_broadcast('status', _sse_current_snapshot())
    finally:
        # تنظيف موارد WebDriver عند الانتهاء
        if bot_instance:
            try:
                if hasattr(bot_instance, 'driver') and bot_instance.driver:
                    bot_instance.driver.quit()
                    logging.info("تم إغلاق WebDriver بنجاح")
            except Exception as cleanup_error:
                logging.warning(f"خطأ أثناء تنظيف WebDriver: {cleanup_error}")
        bot_instance = None
        if bot_state == 'running':
            bot_state = 'stopped'
            bot_state_message = 'تم إيقاف البوت'
        sse_broadcast('status', _sse_current_snapshot())

@api_bp.route('/', methods=['GET'])
@rate_limit(general_limiter)
def index():
    """رسالة ترحيبية عند زيارة الصفحة الرئيسية"""
    return jsonify({
        "status": "online",
        "message": "WhatsApp Control Server is Running. Use /status, /start, /stop endpoints.",
        "version": "2.0.0",
        "features": ["rate_limiting", "auto_cleanup", "secure_ids"]
    })

@api_bp.route('/favicon.ico')
def favicon():
    return '', 204

@api_bp.route('/status', methods=['GET'])
# بدون rate limit - نقطة فحص الاتصال
@require_api_key
def status():
    """معرفة حالة البوت - خفيف وسريع بدون قراءة ملفات"""
    global bot_instance, bot_state, bot_state_message
    is_running = bot_instance is not None and bot_instance.running

    return jsonify({
        "running": is_running,
        "state": bot_state,
        "state_message": bot_state_message,
        "version": "2.0.0"
    })

@api_bp.route('/start', methods=['POST'])
@require_api_key
def start():
    """تشغيل البوت"""
    global bot_thread, bot_instance
    
    if bot_instance and bot_instance.running:
        return jsonify({"message": "البوت يعمل بالفعل"}), 400
        
    if not os.path.exists(sqlite_db.DB_FILE):
        return jsonify({"message": "ملف contacts.db غير موجود. يرجى تشغيل الجسر أولاً."}), 404

    bot_thread = threading.Thread(target=run_bot_thread)
    bot_thread.daemon = True
    bot_thread.start()
    
    logging.info("تم بدء تشغيل البوت بواسطة API")
    return jsonify({"message": "تم بدء تشغيل البوت"})

@api_bp.route('/stop', methods=['POST'])
@require_api_key
def stop():
    """إيقاف البوت"""
    global bot_instance, bot_state, bot_state_message
    if bot_instance:
        bot_instance.stop()
        bot_state = 'stopped'
        bot_state_message = 'تم إيقاف البوت'
        sse_broadcast('status', _sse_current_snapshot())
        logging.info("تم إيقاف البوت بواسطة API")
        return jsonify({"message": "جاري إيقاف البوت..."})
    else:
        bot_state = 'idle'
        bot_state_message = 'في وضع الانتظار'
        sse_broadcast('status', _sse_current_snapshot())
        return jsonify({"message": "البوت متوقف بالفعل"}), 400

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
        import time
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

@api_bp.route('/delete/<id>', methods=['DELETE'])
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
        sse_broadcast('queue_update', {"action": "clear", "added": 0})
        return jsonify({"message": "تم مسح القائمة بنجاح"})
    except Exception as e:
        logging.error(f"خطأ في مسح القائمة: {e}")
        return jsonify({"message": "فشل مسح القائمة"}), 500

@api_bp.route('/send', methods=['POST'])
@rate_limit(send_limiter)
@require_api_key
def send_list():
    """استقبال قائمة الإرسال وحفظها في CSV"""
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
                sqlite_db.append_to_queue(formatted_data)
            else:
                sqlite_db.overwrite_queue(formatted_data)
                
        logging.info(f"تم تحديث قائمة الإرسال: {len(formatted_data)} جهة اتصال (Append={append_mode}).")
        sse_broadcast('queue_update', {"added": len(formatted_data), "action": "send"})
        return jsonify({"message": f"تم حفظ {len(formatted_data)} رسالة في قائمة الانتظار بنجاح."})

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
    Events: 'status' (bot state) | 'queue_update' (queue mutations)
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
    print("   🚀 HADER WHATSAPP PRO SERVER - [v2.0.0 MASTER]")
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
    print("═" * 60)
    print(f"🌐 الرابط المحلي: http://localhost:{PORT}")
    print(f"📊 معدل الحماية: نشط (Rate Limiting Enabled)")
    print("═" * 60 + "\n")
    
    app.run(host=HOST, port=PORT, threaded=True)
