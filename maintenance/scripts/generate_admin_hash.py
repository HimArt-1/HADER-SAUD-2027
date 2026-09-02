#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
═══════════════════════════════════════════════════════════════════════════════
🔐 نظام حاضر - مولّد كلمات المرور المشفرة
═══════════════════════════════════════════════════════════════════════════════

هذا السكربت يقوم بـ:
1. توليد كلمة مرور مشفرة بخوارزمية PBKDF2
2. إنشاء أمر SQL جاهز لإدراج المستخدم في قاعدة البيانات

الاستخدام:
    python generate_admin_hash.py
    
أو مع المعاملات:
    python generate_admin_hash.py --username admin --password MySecurePass123 --name "مدير النظام"

═══════════════════════════════════════════════════════════════════════════════
"""

import hashlib
import secrets
import argparse
import sys
from datetime import datetime

# إعدادات التشفير (متوافقة مع services/security.ts)
ITERATIONS = 100000  # عدد التكرارات
KEY_LENGTH = 32      # 256 bits = 32 bytes
SALT_LENGTH = 16     # 128 bits = 16 bytes

def generate_salt() -> bytes:
    """توليد salt عشوائي آمن"""
    return secrets.token_bytes(SALT_LENGTH)

def hash_password(password: str, salt: bytes = None) -> str:
    """
    تشفير كلمة المرور باستخدام PBKDF2
    
    Args:
        password: كلمة المرور النصية
        salt: الملح (اختياري، يُولّد تلقائياً إذا لم يُحدد)
    
    Returns:
        سلسلة بصيغة: iterations:salt_hex:hash_hex
    """
    if salt is None:
        salt = generate_salt()
    
    # تشفير باستخدام PBKDF2-SHA256
    dk = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt,
        ITERATIONS,
        dklen=KEY_LENGTH
    )
    
    salt_hex = salt.hex()
    hash_hex = dk.hex()
    
    return f"{ITERATIONS}:{salt_hex}:{hash_hex}"

def verify_password(password: str, stored_hash: str) -> bool:
    """
    التحقق من كلمة المرور
    
    Args:
        password: كلمة المرور المُدخلة
        stored_hash: الهاش المخزن بصيغة iterations:salt:hash
    
    Returns:
        True إذا تطابقت كلمة المرور
    """
    try:
        parts = stored_hash.split(':')
        if len(parts) != 3:
            return False
        
        iterations = int(parts[0])
        salt = bytes.fromhex(parts[1])
        original_hash = parts[2]
        
        dk = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt,
            iterations,
            dklen=KEY_LENGTH
        )
        
        return dk.hex() == original_hash
    except Exception as e:
        print(f"❌ خطأ في التحقق: {e}")
        return False

def check_password_strength(password: str) -> dict:
    """
    فحص قوة كلمة المرور
    
    Returns:
        dict مع score, level, feedback, is_valid
    """
    feedback = []
    score = 0
    
    # فحص الطول
    if len(password) < 6:
        feedback.append("كلمة المرور قصيرة جداً (الحد الأدنى 6 أحرف)")
    elif len(password) >= 8:
        score += 20
        if len(password) >= 12:
            score += 10
        if len(password) >= 16:
            score += 10
    else:
        score += 10
    
    # فحص الأحرف
    if any(c.islower() for c in password):
        score += 10
    else:
        feedback.append("أضف حروفاً صغيرة (a-z)")
    
    if any(c.isupper() for c in password):
        score += 15
    else:
        feedback.append("أضف حروفاً كبيرة (A-Z)")
    
    if any(c.isdigit() for c in password):
        score += 15
    else:
        feedback.append("أضف أرقاماً (0-9)")
    
    if any(not c.isalnum() for c in password):
        score += 20
    else:
        feedback.append("أضف رموزاً خاصة (!@#$%)")
    
    # تحديد المستوى
    score = max(0, min(100, score))
    
    if score < 20:
        level = "ضعيفة جداً 🔴"
    elif score < 40:
        level = "ضعيفة 🟠"
    elif score < 60:
        level = "متوسطة 🟡"
    elif score < 80:
        level = "قوية 🟢"
    else:
        level = "ممتازة 💚"
    
    return {
        'score': score,
        'level': level,
        'feedback': feedback if feedback else ["كلمة مرور قوية! ✅"],
        'is_valid': len(password) >= 6 and score >= 30
    }

def generate_sql(username: str, password_hash: str, name: str, role: str = 'site_admin', 
                 email: str = None, phone: str = None) -> str:
    """
    توليد أمر SQL لإنشاء المستخدم
    """
    email_value = f"'{email}'" if email else "NULL"
    phone_value = f"'{phone}'" if phone else "NULL"
    
    sql = f"""
-- =============================================================================
-- 🔐 إنشاء حساب: {username}
-- تاريخ التوليد: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
-- =============================================================================

INSERT INTO users (
    username,
    password,
    password_hash_version,
    name,
    role,
    email,
    phone,
    is_active
)
VALUES (
    '{username}',
    '{password_hash}',
    1,
    '{name}',
    '{role}',
    {email_value},
    {phone_value},
    true
)
ON CONFLICT (username) DO UPDATE SET
    password = EXCLUDED.password,
    password_hash_version = EXCLUDED.password_hash_version,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    updated_at = NOW();

-- التحقق من الإنشاء
SELECT id, username, name, role, is_active, created_at 
FROM users WHERE username = '{username}';
"""
    return sql

def interactive_mode():
    """الوضع التفاعلي"""
    print("\n" + "═" * 60)
    print("🔐 نظام حاضر - مولّد حسابات المدير")
    print("═" * 60 + "\n")
    
    # إدخال البيانات
    username = input("👤 اسم المستخدم: ").strip()
    if not username:
        print("❌ اسم المستخدم مطلوب!")
        return
    
    password = input("🔑 كلمة المرور: ").strip()
    if not password:
        print("❌ كلمة المرور مطلوبة!")
        return
    
    # فحص قوة كلمة المرور
    strength = check_password_strength(password)
    print(f"\n📊 قوة كلمة المرور: {strength['level']} ({strength['score']}/100)")
    for fb in strength['feedback']:
        print(f"   • {fb}")
    
    if not strength['is_valid']:
        confirm = input("\n⚠️ كلمة المرور ضعيفة. هل تريد المتابعة؟ (y/n): ").strip().lower()
        if confirm != 'y':
            print("❌ تم الإلغاء.")
            return
    
    name = input("\n📛 الاسم الظاهر (مثال: مدير النظام): ").strip() or "مدير النظام"
    
    print("\n📋 الأدوار المتاحة:")
    print("   1. site_admin       - مدير النظام (صلاحيات كاملة)")
    print("   2. school_admin     - مدير المدرسة")
    print("   3. supervisor_global - مشرف عام")
    print("   4. supervisor_class  - مشرف فصل")
    print("   5. watcher          - مراقب")
    
    role_choice = input("\n🔐 اختر رقم الدور (1-5) [افتراضي: 1]: ").strip() or "1"
    roles = {
        '1': 'site_admin',
        '2': 'school_admin', 
        '3': 'supervisor_global',
        '4': 'supervisor_class',
        '5': 'watcher'
    }
    role = roles.get(role_choice, 'site_admin')
    
    email = input("\n📧 البريد الإلكتروني (اختياري): ").strip() or None
    phone = input("📱 رقم الجوال (اختياري): ").strip() or None
    
    # توليد الهاش
    print("\n⏳ جاري توليد كلمة المرور المشفرة...")
    password_hash = hash_password(password)
    
    # التحقق
    if verify_password(password, password_hash):
        print("✅ تم التحقق من صحة التشفير!")
    else:
        print("❌ خطأ في التشفير!")
        return
    
    # عرض النتائج
    print("\n" + "═" * 60)
    print("📊 النتائج")
    print("═" * 60)
    
    print(f"\n👤 اسم المستخدم: {username}")
    print(f"🔑 كلمة المرور المشفرة:\n   {password_hash}")
    print(f"📛 الاسم: {name}")
    print(f"🔐 الدور: {role}")
    if email:
        print(f"📧 البريد: {email}")
    if phone:
        print(f"📱 الجوال: {phone}")
    
    # توليد SQL
    sql = generate_sql(username, password_hash, name, role, email, phone)
    
    print("\n" + "═" * 60)
    print("📝 أمر SQL (انسخه إلى Supabase SQL Editor)")
    print("═" * 60)
    print(sql)
    
    # حفظ في ملف
    save = input("\n💾 هل تريد حفظ SQL في ملف؟ (y/n): ").strip().lower()
    if save == 'y':
        filename = f"admin_{username}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(f"-- ⚠️ احذف هذا الملف بعد الاستخدام!\n")
            f.write(f"-- كلمة المرور الأصلية: {password}\n\n")
            f.write(sql)
        print(f"✅ تم الحفظ في: {filename}")
        print("⚠️ تذكير: احذف الملف بعد استخدامه!")

def main():
    parser = argparse.ArgumentParser(
        description='🔐 مولّد حسابات المدير لنظام حاضر',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  python generate_admin_hash.py
  python generate_admin_hash.py --username admin --password MyPass123 --name "مدير"
  python generate_admin_hash.py -u admin -p MyPass123 -n "مدير" --role school_admin
        """
    )
    
    parser.add_argument('-u', '--username', help='اسم المستخدم')
    parser.add_argument('-p', '--password', help='كلمة المرور')
    parser.add_argument('-n', '--name', help='الاسم الظاهر', default='مدير النظام')
    parser.add_argument('-r', '--role', help='الدور', default='site_admin',
                        choices=['site_admin', 'school_admin', 'supervisor_global', 
                                'supervisor_class', 'watcher'])
    parser.add_argument('-e', '--email', help='البريد الإلكتروني')
    parser.add_argument('--phone', help='رقم الجوال')
    parser.add_argument('--hash-only', action='store_true', 
                        help='إظهار الهاش فقط بدون SQL')
    
    args = parser.parse_args()
    
    # إذا لم تُعطَ معاملات، استخدم الوضع التفاعلي
    if not args.username or not args.password:
        interactive_mode()
        return
    
    # توليد الهاش
    password_hash = hash_password(args.password)
    
    if args.hash_only:
        print(password_hash)
        return
    
    # فحص القوة
    strength = check_password_strength(args.password)
    print(f"\n📊 قوة كلمة المرور: {strength['level']}")
    
    # عرض SQL
    sql = generate_sql(
        args.username, 
        password_hash, 
        args.name, 
        args.role,
        args.email,
        args.phone
    )
    print(sql)

if __name__ == '__main__':
    main()
