"""
whattONE — Smart Import Engine
التعرف الذكي على أعمدة ملفات CSV/Excel وتحويلها لطابور رسائل
"""

import os
import re
import logging
from datetime import datetime

logger = logging.getLogger("whattONE.import")

# ═══════════════════════════════════════════════════════
# 🧠 Smart Column Detection — التعرف الذكي على الأعمدة
# ═══════════════════════════════════════════════════════

# Mapping of possible column names → standard internal names
COLUMN_ALIASES = {
    # Student Name
    "student_name": [
        "student_name", "name", "student", "الطالب", "اسم الطالب", "الاسم",
        "اسم", "طالب", "studentname", "اسم_الطالب", "full_name", "الاسم الكامل",
        "اسم الطالب/ة", "اسم الطالبة", "student name"
    ],
    # Phone Number
    "phone": [
        "phone", "mobile", "الهاتف", "الجوال", "رقم الهاتف", "رقم الجوال",
        "جوال", "هاتف", "رقم", "phone_number", "mobile_number", "tel",
        "telephone", "رقم ولي الأمر", "جوال ولي الأمر", "رقم_الجوال",
        "contact", "رقم التواصل", "phone number", "mobile number",
        "parent_phone", "parent phone", "هاتف ولي الأمر", "جوال_ولي_الأمر"
    ],
    # Status (attendance)
    "status": [
        "status", "الحالة", "حالة", "الحضور", "حضور", "attendance",
        "attendance_status", "حالة الحضور", "الموقف", "نوع الغياب",
        "حالة_الحضور", "state"
    ],
    # Grade/Class
    "grade": [
        "grade", "class", "الصف", "صف", "المرحلة", "مرحلة", "level",
        "grade_level", "الصف الدراسي", "المستوى", "year", "السنة",
        "الصف/المرحلة", "grade level",
        "class_name", "class name", "اسم الصف", "الفصل الدراسي"
    ],
    # Section
    "section": [
        "section", "الفصل", "فصل", "الشعبة", "شعبة", "division",
        "class_section", "القسم", "الفصل الدراسي", "room", "الغرفة",
        "section_name", "class section"
    ],
    # Time
    "time": [
        "time", "الوقت", "وقت", "التوقيت", "توقيت", "الساعة", "ساعة",
        "وقت الحضور", "وقت_الحضور", "check_in", "arrival_time",
        "وقت الوصول", "وقت التأخر", "time_in"
    ],
    # Date
    "date": [
        "date", "التاريخ", "تاريخ", "اليوم", "يوم", "day",
        "تاريخ اليوم", "attendance_date", "تاريخ_الحضور"
    ],
    # Parent Name (optional)
    "parent_name": [
        "parent", "parent_name", "ولي الأمر", "اسم ولي الأمر",
        "الأب", "guardian", "ولي_الأمر"
    ],
    # Notes (optional)
    "notes": [
        "notes", "ملاحظات", "ملاحظة", "note", "تعليق", "comments",
        "رسالة", "message"
    ]
}

# Status value normalization
STATUS_ALIASES = {
    "absent": [
        "absent", "غائب", "لم يحضر", "غياب", "لم_يحضر", "غ",
        "عدم حضور", "لم يأتي", "no", "0", "false"
    ],
    "late": [
        "late", "متأخر", "تأخر", "تأخير", "م", "متاخر",
        "وصل متأخر", "وصل متأخراً", "التأخر", "التاخر"
    ],
    "excused": [
        "excused", "مستأذن", "استئذان", "إذن", "اذن", "ا",
        "مستأذن مبكر", "خروج مبكر", "early_leave", "permission",
        "مأذون", "استئذن"
    ],
    "present": [
        "present", "حاضر", "حضر", "حضور", "ح", "yes", "1", "true",
        "موجود"
    ]
}

STATUS_DISPLAY = {
    "absent":  "🔴 لم يحضر",
    "late":    "🟡 متأخر",
    "excused": "🟠 مستأذن",
    "present": "🟢 حاضر"
}

STATUS_EMOJI = {
    "absent":  "🔴",
    "late":    "🟡",
    "excused": "🟠",
    "present": "🟢"
}


def detect_columns(df):
    """
    Detect and map DataFrame columns to standard names.
    Returns a mapping dict: {standard_name: original_column_name}
    """
    mapping = {}
    used_columns = set()
    
    for standard_name, aliases in COLUMN_ALIASES.items():
        for col in df.columns:
            col_clean = str(col).strip().lower().replace('_', ' ').replace('-', ' ')
            for alias in aliases:
                alias_clean = alias.strip().lower().replace('_', ' ').replace('-', ' ')
                if col_clean == alias_clean or alias_clean in col_clean:
                    if col not in used_columns:
                        mapping[standard_name] = col
                        used_columns.add(col)
                        break
            if standard_name in mapping:
                break
    
    logger.info(f"🧠 Column mapping detected: {mapping}")
    return mapping


def normalize_status(value):
    """Normalize a status value to standard form"""
    if not value:
        return "absent"
    
    val = str(value).strip().lower()
    
    for standard, aliases in STATUS_ALIASES.items():
        for alias in aliases:
            if val == alias.lower() or alias.lower() in val:
                return standard
    
    return "absent"  # Default to absent


def smart_import(file_path):
    """
    Smart import from CSV or Excel file.
    Returns: (records_list, column_mapping, stats)
    """
    import pandas as pd
    
    ext = os.path.splitext(file_path)[1].lower()
    
    try:
        if ext in ['.xlsx', '.xls']:
            df = pd.read_excel(file_path, dtype=str)
        elif ext == '.csv':
            # Try different encodings
            for encoding in ['utf-8', 'utf-8-sig', 'cp1256', 'latin-1']:
                try:
                    df = pd.read_csv(file_path, dtype=str, encoding=encoding)
                    break
                except (UnicodeDecodeError, UnicodeError):
                    continue
            else:
                df = pd.read_csv(file_path, dtype=str, encoding='utf-8', errors='replace')
        else:
            raise ValueError(f"نوع ملف غير مدعوم: {ext}")
        
        # Remove completely empty rows
        df = df.dropna(how='all')
        
        if df.empty:
            return [], {}, {"total": 0, "error": "الملف فارغ"}
        
        # Detect columns
        mapping = detect_columns(df)
        
        if 'student_name' not in mapping:
            # Try to guess: first text column that isn't a number
            for col in df.columns:
                sample = df[col].dropna().head(5)
                if len(sample) > 0:
                    is_text = all(not str(v).replace('.','').replace('-','').isdigit() for v in sample)
                    if is_text and len(str(sample.iloc[0])) > 2:
                        mapping['student_name'] = col
                        break
        
        if 'phone' not in mapping:
            # Try to guess: column with digits ~10 chars
            for col in df.columns:
                if col in mapping.values():
                    continue
                sample = df[col].dropna().head(5)
                if len(sample) > 0:
                    looks_phone = all(
                        len(re.sub(r'[^\d]', '', str(v))) >= 8 
                        for v in sample
                    )
                    if looks_phone:
                        mapping['phone'] = col
                        break
        
        # Validate required columns
        if 'phone' not in mapping:
            return [], mapping, {"total": len(df), "error": "لم يتم العثور على عمود رقم الهاتف"}
        
        # Build records
        records = []
        stats = {"total": len(df), "valid": 0, "invalid_phone": 0, "absent": 0, "late": 0, "excused": 0, "present": 0}
        today = datetime.now().strftime("%Y/%m/%d")
        now_time = datetime.now().strftime("%H:%M")
        
        for _, row in df.iterrows():
            phone = str(row.get(mapping.get('phone', ''), '')).strip()
            if not phone or phone == 'nan':
                stats["invalid_phone"] += 1
                continue
            
            # Clean phone
            arabic_map = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
            phone = phone.translate(arabic_map)
            phone = re.sub(r'[^\d]', '', phone)
            
            if len(phone) < 8:
                stats["invalid_phone"] += 1
                continue
            
            # Build record
            record = {
                "phone": phone,
                "student_name": str(row.get(mapping.get('student_name', ''), 'طالب')).strip(),
                "status_type": normalize_status(row.get(mapping.get('status', ''), 'absent')),
                "grade": str(row.get(mapping.get('grade', ''), '')).strip(),
                "section": str(row.get(mapping.get('section', ''), '')).strip(),
                "time": str(row.get(mapping.get('time', ''), now_time)).strip(),
                "date": str(row.get(mapping.get('date', ''), today)).strip(),
                "parent_name": str(row.get(mapping.get('parent_name', ''), '')).strip(),
                "notes": str(row.get(mapping.get('notes', ''), '')).strip(),
            }
            
            # Clean nan values
            for key in record:
                if record[key] == 'nan' or record[key] == 'None':
                    record[key] = ''
            
            if not record["date"]:
                record["date"] = today
            if not record["time"]:
                record["time"] = now_time
            
            stats[record["status_type"]] = stats.get(record["status_type"], 0) + 1
            stats["valid"] += 1
            records.append(record)
        
        logger.info(f"📊 Import stats: {stats}")
        return records, mapping, stats
        
    except Exception as e:
        logger.error(f"❌ Import error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return [], {}, {"total": 0, "error": str(e)}


def get_column_preview(file_path, max_rows=5):
    """
    Read first few rows of a file for column preview.
    Returns: {columns: [...], sample_rows: [[...], ...], detected_mapping: {...}}
    """
    import pandas as pd
    
    ext = os.path.splitext(file_path)[1].lower()
    
    try:
        if ext in ['.xlsx', '.xls']:
            df = pd.read_excel(file_path, dtype=str, nrows=max_rows + 1)
        else:
            for enc in ['utf-8', 'utf-8-sig', 'cp1256', 'latin-1']:
                try:
                    df = pd.read_csv(file_path, dtype=str, encoding=enc, nrows=max_rows + 1)
                    break
                except (UnicodeDecodeError, UnicodeError):
                    continue
        
        df = df.dropna(how='all')
        mapping = detect_columns(df)
        
        columns = list(df.columns)
        sample = df.head(max_rows).fillna('').values.tolist()
        
        return {
            "columns": columns,
            "sample_rows": sample,
            "detected_mapping": mapping,
            "total_rows": len(df)
        }
    except Exception as e:
        return {"columns": [], "sample_rows": [], "detected_mapping": {}, "error": str(e)}
