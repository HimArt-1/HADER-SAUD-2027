"""
Hader Telegram Bot - Configuration
═══════════════════════════════════
Loads settings from .env file
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(env_path)


# ═══════════════════════════════════════════════════════════════
# Telegram Settings
# ═══════════════════════════════════════════════════════════════
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')

# Channel IDs (use @channel_username or numeric ID like -1001234567890)
CHANNELS = {
    'mobile':     os.getenv('TELEGRAM_CHANNEL_MOBILE', ''),      # 📷 حضور ماسح الجوال
    'supervisor': os.getenv('TELEGRAM_CHANNEL_SUPERVISOR', ''),   # 👤 حضور المشرف
    'kiosk':      os.getenv('TELEGRAM_CHANNEL_KIOSK', ''),        # 🖥️ حضور الكشك
    'exits':      os.getenv('TELEGRAM_CHANNEL_EXITS', ''),        # 🚪 الاستئذانات
    'absences':   os.getenv('TELEGRAM_CHANNEL_ABSENCES', ''),     # ❌ الغيابات
    'late':       os.getenv('TELEGRAM_CHANNEL_LATE', ''),         # ⏰ التأخيرات
}

# Admin Telegram user IDs (comma-separated in .env)
ADMIN_IDS = [
    int(uid.strip())
    for uid in os.getenv('TELEGRAM_ADMIN_IDS', '').split(',')
    if uid.strip().isdigit()
]


# ═══════════════════════════════════════════════════════════════
# Supabase Settings
# ═══════════════════════════════════════════════════════════════
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY', '')


# ═══════════════════════════════════════════════════════════════
# WhatsApp Settings
# ═══════════════════════════════════════════════════════════════
WHATSAPP_SERVER_URL = os.getenv('WHATSAPP_SERVER_URL', 'http://localhost:5001/send')


# ═══════════════════════════════════════════════════════════════
# Validation
# ═══════════════════════════════════════════════════════════════
def validate():
    """Check all required config values are present."""
    errors = []
    if not TELEGRAM_BOT_TOKEN:
        errors.append('TELEGRAM_BOT_TOKEN missing in .env')
    if not SUPABASE_URL:
        errors.append('VITE_SUPABASE_URL missing in .env')
    if not SUPABASE_KEY:
        errors.append('VITE_SUPABASE_ANON_KEY missing in .env')
    if not any(CHANNELS.values()):
        errors.append('No TELEGRAM_CHANNEL_* values set in .env')
    if not ADMIN_IDS:
        errors.append('TELEGRAM_ADMIN_IDS missing in .env')
    return errors
