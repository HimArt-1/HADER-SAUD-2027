import os
import sys
import csv
import re
import logging
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

# تحميل المتغيرات البيئية
# تحميل المتغيرات البيئية (دعم المسارات المختلفة)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)

# Try loading from whatsapp folder then parent folder
load_dotenv(os.path.join(BASE_DIR, '.env.local'))
load_dotenv(os.path.join(BASE_DIR, '.env'))
load_dotenv(os.path.join(PARENT_DIR, '.env.local'))
load_dotenv(os.path.join(PARENT_DIR, '.env'))
load_dotenv() # Final fallback

# إعداد السجلات
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Security: Safe output directory
SAFE_OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# إعدادات Supabase
# يفضل وضع هذه القيم في ملف .env أو تمريرها كمتغيرات بيئة
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("VITE_SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("خطأ: يرجى التأكد من تعيين VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في متغيرات البيئة.")
    sys.exit(1)

# تهيئة العميل
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def fetch_absent_students():
    """جلب قائمة الطلاب الغائبين لهذا اليوم"""
    today = datetime.now().strftime('%Y-%m-%d')
    logger.info(f"جاري جلب الغياب ليوم: {today}...")

    try:
        # 1. جلب سجلات الغياب لليوم
        response = supabase.table('attendance_logs')\
            .select('student_id, students(name, guardian_phone, guardian_name)')\
            .eq('date', today)\
            .eq('status', 'absent')\
            .execute()
        
        data = response.data
        
        if not data:
            logger.info("لا يوجد غياب مسجل لهذا اليوم.")
            return []

        contacts = []
        for record in data:
            student = record.get('students')
            if student and student.get('guardian_phone'):
                student_name = student.get('name')
                guardian_phone = student.get('guardian_phone')
                guardian_name = student.get('guardian_name', 'ولي الأمر')
                
                # تنسيق الرسالة
                message = f"مرحباً {guardian_name}، نود إشعاركم بأن الطالب/ة {student_name} تغيب/ت عن الحضور للمدرسة اليوم ({today}). نرجو التواصل معنا للاطمئنان."
                
                contacts.append({
                    'phone': guardian_phone,
                    'message': message
                })
        
        return contacts

    except Exception as e:
        logger.error(f"حدث خطأ أثناء الاتصال بقاعدة البيانات: {e}")
        return []

def save_to_csv(contacts, filename='contacts.csv'):
    """حفظ جهات الاتصال في ملف CSV"""
    if not contacts:
        return

    try:
        # Security: Remove any path components to prevent path traversal
        safe_filename = os.path.basename(filename)
        # Only allow alphanumeric, underscore, hyphen and .csv extension
        if not re.match(r'^[\w\-]+\.csv$', safe_filename):
            safe_filename = 'contacts.csv'
        
        # Use safe output directory
        safe_path = os.path.join(SAFE_OUTPUT_DIR, safe_filename)
        
        with open(safe_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=['phone', 'message'])
            writer.writeheader()
            writer.writerows(contacts)
        logger.info(f"تم حفظ {len(contacts)} جهة اتصال في ملف {safe_path} بنجاح.")
    except (IOError, OSError) as e:
        logger.error(f"حدث خطأ أثناء حفظ الملف: {e}")

if __name__ == "__main__":
    logger.info("--- بدأ تشغيل سكربت الجسر (Hader -> WhatsApp) ---")
    contacts = fetch_absent_students()
    if contacts:
        save_to_csv(contacts)
        logger.info("الآن يمكنك تشغيل أداة واتساب باستخدام ملف contacts.csv الناتج.")
    else:
        logger.info("لم يتم إنشاء ملف CSV لعدم وجود بيانات.")

