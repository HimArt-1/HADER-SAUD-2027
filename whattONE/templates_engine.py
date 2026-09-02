"""
whattONE — Templates Engine
قوالب رسائل الحضور والغياب المنسقة والمخصصة
"""

import os
import json
import logging
from datetime import datetime

logger = logging.getLogger("whattONE.templates")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_FILE = os.path.join(BASE_DIR, "templates.json")

# ═══════════════════════════════════════════════════════
# 📝 Default Templates — القوالب الافتراضية
# ═══════════════════════════════════════════════════════

DEFAULT_TEMPLATES = {
    # ─────────────── غياب ───────────────
    "absent": {
        "id": "absent",
        "name": "🔴 لم يحضر (غياب)",
        "name_en": "Absent",
        "emoji": "🔴",
        "category": "attendance",
        "message": (
            "━━━━━━━━━━━━━━━━━\n"
            "🔴 *إشعار غياب*\n"
            "━━━━━━━━━━━━━━━━━\n"
            "\n"
            "📌 *الطالب:* {student_name}\n"
            "🏫 *الصف:* {grade} - {section}\n"
            "📅 *التاريخ:* {date}\n"
            "\n"
            "نود إبلاغكم بأن الطالب *{student_name}* لم يحضر اليوم إلى المدرسة.\n"
            "\n"
            "نرجو التواصل مع إدارة المدرسة لتوضيح سبب الغياب.\n"
            "\n"
            "مع تحيات إدارة المدرسة 🏫"
        ),
        "is_default": True
    },

    # ─────────────── تأخر ───────────────
    "late": {
        "id": "late",
        "name": "🟡 متأخر",
        "name_en": "Late",
        "emoji": "🟡",
        "category": "attendance",
        "message": (
            "━━━━━━━━━━━━━━━━━\n"
            "🟡 *إشعار تأخر*\n"
            "━━━━━━━━━━━━━━━━━\n"
            "\n"
            "📌 *الطالب:* {student_name}\n"
            "🏫 *الصف:* {grade} - {section}\n"
            "📅 *التاريخ:* {date}\n"
            "🕐 *وقت الوصول:* {time}\n"
            "\n"
            "نود إعلامكم بأن الطالب *{student_name}* وصل متأخراً إلى المدرسة اليوم في تمام الساعة *{time}*.\n"
            "\n"
            "نأمل الحرص على الحضور في الوقت المحدد.\n"
            "\n"
            "مع تحيات إدارة المدرسة 🏫"
        ),
        "is_default": True
    },

    # ─────────────── استئذان ───────────────
    "excused": {
        "id": "excused",
        "name": "🟠 مستأذن",
        "name_en": "Excused",
        "emoji": "🟠",
        "category": "attendance",
        "message": (
            "━━━━━━━━━━━━━━━━━\n"
            "🟠 *إشعار استئذان*\n"
            "━━━━━━━━━━━━━━━━━\n"
            "\n"
            "📌 *الطالب:* {student_name}\n"
            "🏫 *الصف:* {grade} - {section}\n"
            "📅 *التاريخ:* {date}\n"
            "🕐 *وقت الاستئذان:* {time}\n"
            "\n"
            "نود إعلامكم بأن الطالب *{student_name}* قد استأذن من المدرسة اليوم في تمام الساعة *{time}*.\n"
            "\n"
            "نرجو التأكد من وصول الطالب للمنزل بسلامة.\n"
            "\n"
            "مع تحيات إدارة المدرسة 🏫"
        ),
        "is_default": True
    },

    # ─────────────── تنبيه غياب متكرر ───────────────
    "absent_warning": {
        "id": "absent_warning",
        "name": "⚠️ تنبيه غياب متكرر",
        "name_en": "Repeated Absence Warning",
        "emoji": "⚠️",
        "category": "attendance",
        "message": (
            "━━━━━━━━━━━━━━━━━\n"
            "⚠️ *تنبيه غياب متكرر*\n"
            "━━━━━━━━━━━━━━━━━\n"
            "\n"
            "📌 *الطالب:* {student_name}\n"
            "🏫 *الصف:* {grade} - {section}\n"
            "📅 *التاريخ:* {date}\n"
            "\n"
            "نود لفت انتباهكم إلى تكرار غياب الطالب *{student_name}* عن المدرسة.\n"
            "\n"
            "يرجى الحضور لإدارة المدرسة في أقرب وقت ممكن لمناقشة الوضع الدراسي للطالب.\n"
            "\n"
            "مع تحيات إدارة المدرسة 🏫"
        ),
        "is_default": True
    },

    # ─────────────── رسالة عامة ───────────────
    "general": {
        "id": "general",
        "name": "📢 رسالة عامة",
        "name_en": "General Message",
        "emoji": "📢",
        "category": "general",
        "message": (
            "━━━━━━━━━━━━━━━━━\n"
            "📢 *إشعار من المدرسة*\n"
            "━━━━━━━━━━━━━━━━━\n"
            "\n"
            "📌 *الطالب:* {student_name}\n"
            "🏫 *الصف:* {grade} - {section}\n"
            "📅 *التاريخ:* {date}\n"
            "\n"
            "{notes}\n"
            "\n"
            "مع تحيات إدارة المدرسة 🏫"
        ),
        "is_default": True
    }
}

# Available placeholders
PLACEHOLDERS = {
    "{student_name}": "اسم الطالب",
    "{phone}": "رقم الهاتف",
    "{grade}": "الصف",
    "{section}": "الفصل",
    "{date}": "التاريخ",
    "{time}": "الوقت",
    "{parent_name}": "اسم ولي الأمر",
    "{notes}": "ملاحظات",
    "{status}": "الحالة",
    "{school_name}": "اسم المدرسة"
}


# ═══════════════════════════════════════════════════════
# 🔧 Template Management
# ═══════════════════════════════════════════════════════

def load_templates():
    """Load templates from file, or return defaults"""
    try:
        if os.path.exists(TEMPLATES_FILE):
            with open(TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                saved = json.load(f)
            # Merge saved with defaults (defaults as base)
            merged = {**DEFAULT_TEMPLATES}
            merged.update(saved)
            return merged
    except Exception as e:
        logger.error(f"Error loading templates: {e}")
    return {**DEFAULT_TEMPLATES}


def save_templates(templates):
    """Save templates to file"""
    try:
        with open(TEMPLATES_FILE, 'w', encoding='utf-8') as f:
            json.dump(templates, f, ensure_ascii=False, indent=2)
        logger.info("💾 Templates saved")
        return True
    except Exception as e:
        logger.error(f"Error saving templates: {e}")
        return False


def get_template(template_id):
    """Get a specific template"""
    templates = load_templates()
    return templates.get(template_id)


def add_template(template_data):
    """Add or update a custom template"""
    templates = load_templates()
    tid = template_data.get('id', f"custom_{len(templates)}")
    template_data['id'] = tid
    template_data['is_default'] = False
    templates[tid] = template_data
    save_templates(templates)
    return tid


def delete_template(template_id):
    """Delete a custom template (not defaults)"""
    templates = load_templates()
    if template_id in templates:
        if templates[template_id].get('is_default'):
            return False, "لا يمكن حذف القوالب الافتراضية"
        del templates[template_id]
        save_templates(templates)
        return True, "تم حذف القالب"
    return False, "القالب غير موجود"


def render_message(template_id, record, settings=None):
    """
    Render a message from a template + record data.
    record: dict with student_name, phone, grade, section, date, time, etc.
    settings: dict with school_name, etc.
    """
    settings = settings or {}
    template = get_template(template_id)
    
    if not template:
        # Fallback to matching status
        status = record.get('status_type', 'absent')
        template = get_template(status)
    
    if not template:
        template = DEFAULT_TEMPLATES['absent']
    
    msg = template['message']
    
    today = datetime.now().strftime("%Y/%m/%d")
    now_time = datetime.now().strftime("%H:%M")
    
    # Replace placeholders
    replacements = {
        "{student_name}": record.get('student_name', 'طالب'),
        "{phone}": record.get('phone', ''),
        "{grade}": record.get('grade', ''),
        "{section}": record.get('section', ''),
        "{date}": record.get('date', today),
        "{time}": record.get('time', now_time),
        "{parent_name}": record.get('parent_name', ''),
        "{notes}": record.get('notes', ''),
        "{status}": STATUS_DISPLAY_MAP.get(record.get('status_type', 'absent'), 'لم يحضر'),
        "{school_name}": settings.get('school_name', 'المدرسة'),
    }
    
    for placeholder, value in replacements.items():
        msg = msg.replace(placeholder, str(value) if value else '')
    
    return msg


# Status display for render
STATUS_DISPLAY_MAP = {
    "absent": "لم يحضر",
    "late": "متأخر",
    "excused": "مستأذن",
    "present": "حاضر"
}


def prepare_queue_from_import(records, settings=None):
    """
    Convert imported records to message queue items.
    Each record gets the appropriate template based on status_type.
    """
    import uuid
    
    settings = settings or {}
    queue_items = []
    
    for record in records:
        status_type = record.get('status_type', 'absent')
        
        # Skip present students
        if status_type == 'present' and not settings.get('notify_present', False):
            continue
        
        message = render_message(status_type, record, settings)
        
        queue_items.append({
            "id": str(uuid.uuid4()),
            "phone": record.get('phone', ''),
            "message": message,
            "student_name": record.get('student_name', ''),
            "status_type": status_type,
            "grade": record.get('grade', ''),
            "section": record.get('section', ''),
            "attachment": None,
            "status": "pending"
        })
    
    return queue_items
