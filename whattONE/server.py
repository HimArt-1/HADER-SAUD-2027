"""
whattONE Server v2 — خادم واتساب مستقل محسّن
Flask API + Smart Import + Templates + Web Dashboard
"""

from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
from flask_cors import CORS
from functools import wraps
import threading
import logging
import os
import sys
import secrets
import time
import uuid
import json
import glob
import queue as queue_module
from datetime import datetime, timedelta
from collections import defaultdict

# === Setup ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from whatsapp_engine import WhatsAppEngine
from smart_import import smart_import, get_column_preview, STATUS_DISPLAY, STATUS_EMOJI
from templates_engine import (
    load_templates, save_templates, get_template, add_template,
    delete_template, render_message, prepare_queue_from_import, DEFAULT_TEMPLATES,
    PLACEHOLDERS
)

# === Configuration ===
PORT = int(os.environ.get('WHATTONE_PORT', 5005))
HOST = os.environ.get('WHATTONE_HOST', '0.0.0.0').strip() or '0.0.0.0'
API_KEY = (os.environ.get('WHATTONE_API_KEY') or '').strip() or None
CSV_FILE = os.path.join(BASE_DIR, "queue.csv")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
IMPORTS_DIR = os.path.join(BASE_DIR, "imports")
LOG_DIR = os.path.join(BASE_DIR, "logs")
SETTINGS_FILE = os.path.join(BASE_DIR, "settings.json")
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'csv', 'xlsx', 'xls'}
MAX_FILE_SIZE = 16 * 1024 * 1024

# === Flask App ===
app = Flask(__name__, static_folder='dashboard', static_url_path='/static')
CORS(app, resources={r"/api/*": {"origins": "*"}})

for d in [UPLOADS_DIR, IMPORTS_DIR, LOG_DIR]:
    os.makedirs(d, exist_ok=True)

# === Logging ===
class OptionsFilter(logging.Filter):
    def filter(self, record):
        return 'OPTIONS' not in record.getMessage()

logging.root.handlers.clear()

file_handler = logging.FileHandler(os.path.join(LOG_DIR, "server.log"), encoding='utf-8')
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
file_handler.addFilter(OptionsFilter())
logging.root.addHandler(file_handler)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
console_handler.addFilter(OptionsFilter())
logging.root.addHandler(console_handler)

logging.root.setLevel(logging.INFO)
logger = logging.getLogger("whattONE.server")

# === State ===
bot_instance = None
bot_thread = None
bot_state = 'idle'
bot_state_message = 'في وضع الانتظار'
file_lock = threading.Lock()

# ═══════════════════════════════════════════
# 📡 SSE — Server-Sent Events Registry
# ═══════════════════════════════════════════

_sse_clients: list[queue_module.Queue] = []
_sse_lock = threading.Lock()


def _sse_current_snapshot() -> dict:
    """Returns the current bot state as a dict for initial/keepalive payloads."""
    is_running = bot_instance is not None and bot_instance.running
    stats = bot_instance.get_stats() if bot_instance else {}
    return {
        "running": is_running,
        "state": bot_state,
        "state_message": bot_state_message,
        "stats": stats,
    }


def sse_broadcast(event_type: str, data: dict) -> None:
    """
    Push an SSE event to every connected client.
    Dead clients (closed connections) are pruned automatically.
    Thread-safe — can be called from any thread.
    """
    payload = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    with _sse_lock:
        dead: list[queue_module.Queue] = []
        for q in _sse_clients:
            try:
                q.put_nowait(payload)
            except queue_module.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


# === Settings ===
def load_settings():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {
        "school_name": "المدرسة",
        "notify_present": False,
        "batch_size": 5,
        "min_delay": 25,
        "max_delay": 60,
        "long_break": 180,
        "auto_start": False
    }

def save_settings(settings):
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


# ═══════════════════════════════════════════
# 🛡️ Security & Rate Limiting
# ═══════════════════════════════════════════

class RateLimiter:
    def __init__(self, max_requests=60, window_seconds=60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self.lock = threading.Lock()

    def is_allowed(self, client_ip):
        with self.lock:
            now = time.time()
            self.requests[client_ip] = [
                t for t in self.requests[client_ip] if now - t < self.window_seconds
            ]
            if len(self.requests[client_ip]) >= self.max_requests:
                return False
            self.requests[client_ip].append(now)
            return True

general_limiter = RateLimiter(100, 60)
send_limiter = RateLimiter(30, 60)
upload_limiter = RateLimiter(20, 60)

def rate_limit(limiter):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            ip = request.remote_addr or 'unknown'
            if not limiter.is_allowed(ip):
                return jsonify({"error": "تم تجاوز الحد الأقصى للطلبات"}), 429
            return f(*args, **kwargs)
        return wrapper
    return decorator

def require_api_key(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not API_KEY:
            return f(*args, **kwargs)
        key = request.headers.get('X-API-Key')
        if not key or not secrets.compare_digest(key, API_KEY):
            return jsonify({"error": "غير مصرح"}), 401
        return f(*args, **kwargs)
    return wrapper

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# ═══════════════════════════════════════════
# 🤖 Bot Control
# ═══════════════════════════════════════════

def run_bot_thread():
    global bot_instance, bot_state, bot_state_message
    try:
        settings = load_settings()

        if not os.path.exists(CSV_FILE):
            import pandas as pd
            pd.DataFrame(columns=['id','phone','message','student_name','status_type','grade','section','attachment','status']).to_csv(CSV_FILE, index=False)

        # Cleanup ONLY lock files — preserve session cookies/data
        session_dir = os.path.join(BASE_DIR, 'session_data')
        for lock in ['SingletonLock', 'SingletonSocket', 'SingletonCookie']:
            p = os.path.join(session_dir, lock)
            if os.path.exists(p) or os.path.islink(p):
                try: os.remove(p)
                except: pass

        bot_state = 'initializing'
        bot_state_message = 'جاري تهيئة المتصفح...'
        sse_broadcast('status', _sse_current_snapshot())
        bot_instance = WhatsAppEngine(CSV_FILE, file_lock)

        if not bot_instance.init_browser():
            bot_state = 'error'
            bot_state_message = 'فشل تهيئة المتصفح - تأكد من تثبيت Chrome'
            sse_broadcast('status', _sse_current_snapshot())
            return

        bot_state = 'waiting_login'
        bot_state_message = 'بانتظار مسح رمز QR...'
        sse_broadcast('status', _sse_current_snapshot())

        if bot_instance.check_login():
            bot_state = 'running'
            bot_state_message = 'البوت يعمل ويرسل الرسائل'
            sse_broadcast('status', _sse_current_snapshot())
            bot_instance.run_mission(
                batch_size=settings.get('batch_size', 5),
                min_delay=settings.get('min_delay', 25),
                max_delay=settings.get('max_delay', 60),
                long_break=settings.get('long_break', 180),
                continuous=True
            )
        else:
            bot_state = 'error'
            bot_state_message = 'فشل تسجيل الدخول - يرجى مسح QR'
            sse_broadcast('status', _sse_current_snapshot())
    except Exception as e:
        bot_state = 'error'
        bot_state_message = f'خطأ: {str(e)[:100]}'
        logger.error(f"Bot error: {e}")
        sse_broadcast('status', _sse_current_snapshot())
    finally:
        if bot_instance:
            try:
                if hasattr(bot_instance, 'driver') and bot_instance.driver:
                    bot_instance.driver.quit()
            except Exception:
                pass
        bot_instance = None
        if bot_state == 'running':
            bot_state = 'stopped'
            bot_state_message = 'تم إيقاف البوت'
        sse_broadcast('status', _sse_current_snapshot())

# ═══════════════════════════════════════════
# 🐕 Watchdog — auto-restart on inactivity
# ═══════════════════════════════════════════

_watchdog_running = False


def _watchdog_loop():
    """Monitor the bot instance every 30s. If no activity for 5 min, restart."""
    global bot_instance, bot_state, bot_state_message, _watchdog_running
    INACTIVITY_TIMEOUT = 300  # 5 minutes
    _watchdog_running = True
    logger.info("🐕 Watchdog started (timeout: 5 min)")

    while _watchdog_running:
        time.sleep(30)
        if bot_instance and bot_instance.running:
            elapsed = time.time() - getattr(bot_instance, 'last_activity_time', time.time())
            if elapsed > INACTIVITY_TIMEOUT:
                logger.warning(f"🐕 Watchdog: No activity for {int(elapsed)}s — restarting browser…")
                try:
                    bot_instance.driver.refresh()
                    time.sleep(10)
                    if not bot_instance.check_login():
                        logger.error("🐕 Session lost after watchdog refresh — stopping bot")
                        bot_instance.stop()
                        bot_state = 'error'
                        bot_state_message = 'Watchdog: فقدت الجلسة بعد إعادة التحميل'
                        sse_broadcast('status', _sse_current_snapshot())
                    else:
                        bot_instance.last_activity_time = time.time()
                        logger.info("🐕 Watchdog: Browser refreshed, session OK.")
                except Exception as e:
                    logger.error(f"🐕 Watchdog refresh failed: {e}")
                    bot_instance.stop()
                    bot_state = 'error'
                    bot_state_message = f'Watchdog: خطأ — {str(e)[:80]}'
                    sse_broadcast('status', _sse_current_snapshot())


def start_watchdog():
    """Start watchdog in a daemon thread."""
    t = threading.Thread(target=_watchdog_loop, daemon=True, name="watchdog")
    t.start()
    return t


def cleanup_old_files():
    try:
        cutoff = datetime.now() - timedelta(hours=24)
        for folder in [UPLOADS_DIR, IMPORTS_DIR]:
            if os.path.exists(folder):
                for f in glob.glob(os.path.join(folder, '*')):
                    if os.path.isfile(f):
                        if datetime.fromtimestamp(os.path.getmtime(f)) < cutoff:
                            os.remove(f)
    except Exception:
        pass

def start_cleanup_scheduler():
    def task():
        while True:
            time.sleep(3600)
            cleanup_old_files()
    threading.Thread(target=task, daemon=True).start()


# ═══════════════════════════════════════════
# 🌐 Dashboard Routes
# ═══════════════════════════════════════════

@app.route('/')
def serve_dashboard():
    return send_from_directory('dashboard', 'index.html')

@app.route('/dashboard/<path:filename>')
def serve_dashboard_files(filename):
    return send_from_directory('dashboard', filename)

@app.route('/favicon.ico')
def favicon():
    # Return a simple green circle as favicon
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#25D366"/><text x="50" y="68" font-size="55" text-anchor="middle" fill="white">W</text></svg>'
    from flask import Response
    return Response(svg, mimetype='image/svg+xml')


# ═══════════════════════════════════════════
# 📡 Core API
# ═══════════════════════════════════════════

@app.route('/api/status', methods=['GET'])
@require_api_key
def api_status():
    is_running = bot_instance is not None and bot_instance.running
    stats = bot_instance.get_stats() if bot_instance else {}
    return jsonify({
        "running": is_running,
        "state": bot_state,
        "state_message": bot_state_message,
        "stats": stats,
        "version": "2.0.0"
    })

@app.route('/api/start', methods=['POST'])
@require_api_key
def api_start():
    global bot_thread, bot_instance
    if bot_instance and bot_instance.running:
        return jsonify({"message": "البوت يعمل بالفعل"}), 400
    bot_thread = threading.Thread(target=run_bot_thread)
    bot_thread.daemon = True
    bot_thread.start()
    return jsonify({"message": "تم بدء تشغيل البوت"})

@app.route('/api/stop', methods=['POST'])
@require_api_key
def api_stop():
    global bot_instance, bot_state, bot_state_message
    if bot_instance:
        bot_instance.stop()
        bot_state = 'stopped'
        bot_state_message = 'تم إيقاف البوت'
        sse_broadcast('status', _sse_current_snapshot())
        return jsonify({"message": "جاري إيقاف البوت..."})
    bot_state = 'idle'
    bot_state_message = 'في وضع الانتظار'
    sse_broadcast('status', _sse_current_snapshot())
    return jsonify({"message": "البوت متوقف بالفعل"})


# ═══════════════════════════════════════════
# 📨 Queue API
# ═══════════════════════════════════════════

@app.route('/api/send', methods=['POST'])
@rate_limit(send_limiter)
@require_api_key
def api_send():
    """Add messages to queue"""
    try:
        import pandas as pd
        data = request.json
        append = request.args.get('append', 'true').lower() == 'true'

        if not data or not isinstance(data, list):
            return jsonify({"message": "يجب أن تكون البيانات قائمة"}), 400
        if len(data) > 500:
            return jsonify({"message": "الحد الأقصى 500 رسالة"}), 400

        new_df = pd.DataFrame(data)
        if 'phone' not in new_df.columns or 'message' not in new_df.columns:
            return jsonify({"message": "يجب أن تحتوي على phone و message"}), 400

        for col in ['attachment', 'student_name', 'status_type', 'grade', 'section']:
            if col not in new_df.columns:
                new_df[col] = ''
        if 'id' not in new_df.columns:
            new_df['id'] = [str(uuid.uuid4()) for _ in range(len(new_df))]
        if 'status' not in new_df.columns:
            new_df['status'] = 'pending'

        with file_lock:
            if append and os.path.exists(CSV_FILE):
                try:
                    old_df = pd.read_csv(CSV_FILE, dtype=object)
                    final_df = pd.concat([old_df, new_df], ignore_index=True)
                except Exception:
                    final_df = new_df
            else:
                final_df = new_df
            final_df.to_csv(CSV_FILE, index=False)

        sse_broadcast('queue_update', {"added": len(new_df), "action": "send"})
        return jsonify({"message": f"تم إضافة {len(new_df)} رسالة"})
    except Exception as e:
        logger.error(f"Send error: {e}")
        return jsonify({"message": "فشل إضافة الرسائل"}), 500

@app.route('/api/queue', methods=['GET'])
@require_api_key
def api_queue():
    import pandas as pd
    try:
        with file_lock:
            if not os.path.exists(CSV_FILE):
                return jsonify([])
            df = pd.read_csv(CSV_FILE, dtype=object)
            df = df.where(pd.notnull(df), None)
            return jsonify(df.to_dict(orient='records'))
    except Exception:
        return jsonify([])

@app.route('/api/queue/<msg_id>', methods=['DELETE'])
@require_api_key
def api_delete_message(msg_id):
    import pandas as pd
    try:
        msg_id = str(msg_id).strip()
        with file_lock:
            if os.path.exists(CSV_FILE):
                df = pd.read_csv(CSV_FILE, dtype=object)
                if 'id' in df.columns:
                    df['id'] = df['id'].astype(str).str.strip()
                    n = len(df)
                    df = df[df['id'] != msg_id]
                    if len(df) == n:
                        return jsonify({"message": "غير موجود"}), 404
                    df.to_csv(CSV_FILE, index=False)
                    return jsonify({"message": "تم الحذف"})
        return jsonify({"message": "غير موجود"}), 404
    except Exception as e:
        logger.error(f"Delete error: {e}")
        return jsonify({"message": "فشل"}), 500

@app.route('/api/clear', methods=['POST'])
@require_api_key
def api_clear():
    import pandas as pd
    try:
        with file_lock:
            pd.DataFrame(columns=['id','phone','message','student_name','status_type','grade','section','attachment','status']).to_csv(CSV_FILE, index=False)
        sse_broadcast('queue_update', {"action": "clear", "added": 0})
        return jsonify({"message": "تم مسح الطابور"})
    except Exception:
        return jsonify({"message": "فشل"}), 500


# ═══════════════════════════════════════════
# 📡 SSE Stream Endpoint
# ═══════════════════════════════════════════

@app.route('/api/events', methods=['GET'])
@require_api_key
def api_events():
    """
    Server-Sent Events endpoint.
    Clients connect once and receive push updates without polling.
    Events: 'status' (bot state changes) | 'queue_update' (queue mutations)
    """
    client_q: queue_module.Queue = queue_module.Queue(maxsize=50)

    with _sse_lock:
        _sse_clients.append(client_q)

    def generate():
        # Send current snapshot immediately so client is in sync on connect
        try:
            snapshot = _sse_current_snapshot()
            yield f"event: status\ndata: {json.dumps(snapshot, ensure_ascii=False)}\n\n"
        except Exception:
            pass

        try:
            while True:
                try:
                    # Block until an event arrives or 30 s keepalive fires
                    payload = client_q.get(timeout=30)
                    yield payload
                except queue_module.Empty:
                    # Keepalive comment — prevents proxies from closing the connection
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


# ═══════════════════════════════════════════
# 📥 Smart Import API
# ═══════════════════════════════════════════

@app.route('/api/import/upload', methods=['POST'])
@rate_limit(upload_limiter)
@require_api_key
def api_import_upload():
    """Upload a file for smart import (step 1: preview)"""
    try:
        if 'file' not in request.files:
            return jsonify({"message": "لم يتم إرفاق ملف"}), 400

        file = request.files['file']
        if not file.filename:
            return jsonify({"message": "اسم الملف فارغ"}), 400

        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
        if ext not in ['csv', 'xlsx', 'xls']:
            return jsonify({"message": "يجب أن يكون الملف CSV أو Excel"}), 400

        import werkzeug.utils
        safe_name = werkzeug.utils.secure_filename(file.filename)
        filename = f"{int(time.time())}_{safe_name}"
        filepath = os.path.join(IMPORTS_DIR, filename)
        file.save(filepath)

        # Get preview
        preview = get_column_preview(filepath)
        preview['file_path'] = filepath
        preview['filename'] = filename

        logger.info(f"📥 Imported file for preview: {filename}, columns: {preview.get('columns', [])}")
        return jsonify(preview)
    except Exception as e:
        logger.error(f"Import upload error: {e}")
        return jsonify({"message": str(e)}), 500

@app.route('/api/import/process', methods=['POST'])
@require_api_key
def api_import_process():
    """Process imported file and add to queue (step 2)"""
    try:
        import pandas as pd

        data = request.json
        file_path = data.get('file_path', '')

        if not file_path or not os.path.exists(file_path):
            return jsonify({"message": "الملف غير موجود"}), 404

        settings = load_settings()
        custom_settings = data.get('settings', {})
        settings.update(custom_settings)

        # Smart import
        records, mapping, stats = smart_import(file_path)

        if stats.get('error'):
            return jsonify({"message": stats['error'], "stats": stats}), 400

        if not records:
            return jsonify({"message": "لم يتم العثور على سجلات صالحة", "stats": stats}), 400

        # Apply status override if selected
        status_override = data.get('status_override', 'auto')
        if status_override and status_override != 'auto':
            for record in records:
                record['status_type'] = status_override
            # Recalculate stats
            stats['absent'] = sum(1 for r in records if r['status_type'] == 'absent')
            stats['late'] = sum(1 for r in records if r['status_type'] == 'late')
            stats['excused'] = sum(1 for r in records if r['status_type'] == 'excused')
            stats['present'] = sum(1 for r in records if r['status_type'] == 'present')
            logger.info(f"📌 Status override applied: {status_override} for {len(records)} records")

        # Convert to queue items using templates
        queue_items = prepare_queue_from_import(records, settings)

        if not queue_items:
            return jsonify({"message": "لا توجد رسائل لإرسالها", "stats": stats}), 400

        # Add to queue
        new_df = pd.DataFrame(queue_items)

        with file_lock:
            if os.path.exists(CSV_FILE):
                try:
                    old_df = pd.read_csv(CSV_FILE, dtype=object)
                    final_df = pd.concat([old_df, new_df], ignore_index=True)
                except Exception:
                    final_df = new_df
            else:
                final_df = new_df
            final_df.to_csv(CSV_FILE, index=False)

        stats['queued'] = len(queue_items)
        logger.info(f"📊 Import processed: {stats}")

        return jsonify({
            "message": f"تم إضافة {len(queue_items)} رسالة للطابور",
            "stats": stats,
            "mapping": mapping
        })
    except Exception as e:
        logger.error(f"Import process error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({"message": str(e)}), 500


# ═══════════════════════════════════════════
# 📝 Templates API
# ═══════════════════════════════════════════

@app.route('/api/templates', methods=['GET'])
def api_get_templates():
    templates = load_templates()
    return jsonify(list(templates.values()))

@app.route('/api/templates/<template_id>', methods=['GET'])
def api_get_template(template_id):
    t = get_template(template_id)
    if t:
        return jsonify(t)
    return jsonify({"message": "غير موجود"}), 404

@app.route('/api/templates', methods=['POST'])
@require_api_key
def api_add_template():
    data = request.json
    if not data or 'message' not in data:
        return jsonify({"message": "يجب تحديد نص القالب"}), 400
    tid = add_template(data)
    return jsonify({"message": "تم حفظ القالب", "id": tid})

@app.route('/api/templates/<template_id>', methods=['PUT'])
@require_api_key
def api_update_template(template_id):
    data = request.json
    templates = load_templates()
    if template_id in templates:
        data['id'] = template_id
        templates[template_id].update(data)
        save_templates(templates)
        return jsonify({"message": "تم تحديث القالب"})
    return jsonify({"message": "غير موجود"}), 404

@app.route('/api/templates/<template_id>', methods=['DELETE'])
@require_api_key
def api_delete_template(template_id):
    ok, msg = delete_template(template_id)
    return jsonify({"message": msg}), 200 if ok else 400

@app.route('/api/templates/preview', methods=['POST'])
def api_preview_template():
    """Preview a template with sample data"""
    data = request.json or {}
    template_id = data.get('template_id', 'absent')
    
    sample = {
        "student_name": data.get('student_name', 'أحمد محمد العلي'),
        "phone": "966501234567",
        "grade": data.get('grade', 'الرابع'),
        "section": data.get('section', 'أ'),
        "date": datetime.now().strftime("%Y/%m/%d"),
        "time": datetime.now().strftime("%H:%M"),
        "parent_name": "محمد العلي",
        "notes": "ملاحظة تجريبية",
        "status_type": template_id
    }
    
    message = render_message(template_id, sample, load_settings())
    return jsonify({"message": message, "record": sample})

@app.route('/api/placeholders', methods=['GET'])
def api_placeholders():
    return jsonify(PLACEHOLDERS)


# ═══════════════════════════════════════════
# ⚙️ Settings API
# ═══════════════════════════════════════════

@app.route('/api/settings', methods=['GET'])
@require_api_key
def api_get_settings():
    return jsonify(load_settings())

@app.route('/api/settings', methods=['POST'])
@require_api_key
def api_save_settings():
    data = request.json
    if not data:
        return jsonify({"message": "بيانات فارغة"}), 400
    settings = load_settings()
    settings.update(data)
    save_settings(settings)
    return jsonify({"message": "تم حفظ الإعدادات"})


# ═══════════════════════════════════════════
# 📎 Upload API
# ═══════════════════════════════════════════

@app.route('/api/upload', methods=['POST'])
@rate_limit(upload_limiter)
@require_api_key
def api_upload():
    try:
        if 'file' not in request.files:
            return jsonify({"message": "لم يتم إرفاق ملف"}), 400
        file = request.files['file']
        if not file.filename:
            return jsonify({"message": "اسم فارغ"}), 400

        import werkzeug.utils
        safe_name = werkzeug.utils.secure_filename(file.filename)
        filename = f"{int(time.time())}_{safe_name}"
        filepath = os.path.join(UPLOADS_DIR, filename)
        file.save(filepath)
        return jsonify({"path": filepath, "filename": filename, "message": "تم الرفع"})
    except Exception as e:
        return jsonify({"message": str(e)}), 500


# ═══════════════════════════════════════════
# 📜 Logs API
# ═══════════════════════════════════════════

@app.route('/api/logs', methods=['GET'])
@require_api_key
def api_logs():
    try:
        log_file = os.path.join(LOG_DIR, "server.log")
        if not os.path.exists(log_file):
            return jsonify({"logs": []})
        with open(log_file, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
        return jsonify({"logs": lines[-100:]})
    except Exception:
        return jsonify({"logs": []})


# ═══════════════════════════════════════════
# 🚀 Main
# ═══════════════════════════════════════════

if __name__ == '__main__':
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║  🟢  whattONE v2.0 — أداة واتساب المتقدمة           ║")
    print("╠══════════════════════════════════════════════════════╣")
    print(f"║  🌐 Dashboard: http://localhost:{PORT}                  ║")
    print(f"║  📡 API:       http://localhost:{PORT}/api/status        ║")
    print("║  📝 Templates: غياب • تأخر • استئذان                  ║")
    print("║  📥 Import:    CSV / Excel                            ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    start_cleanup_scheduler()
    start_watchdog()
    cleanup_old_files()

    app.run(host=HOST, port=PORT, debug=False)
