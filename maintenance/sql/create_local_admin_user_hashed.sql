-- =============================================================================
-- إنشاء حساب مدير مؤقت للاختبارات المحلية (admin / admin123) باستخدام PBKDF2
-- =============================================================================
-- ⚠️ للاستخدام المحلي فقط. لا تستخدم هذه البيانات الافتراضية في بيئة الإنتاج.
-- كلمة المرور مخزنة بصيغة iterations:salt:hash لضمان عدم حفظها بنص واضح.
-- =============================================================================
INSERT INTO users (username, password, password_hash_version, name, role, is_active)
VALUES (
  'admin',
  '100000:03d815218edcacaf6abfc86a4a0271ca:7dbfa3a2c81ce0fef420dfde79c7c09ded5efaeec8a0dd660937e9553a983fcf',
  1,
  'مدير تجريبي (محلي فقط)',
  'site_admin',
  true
)
ON CONFLICT (username) DO NOTHING;

-- تحقق من إنشاء الحساب المؤقت
SELECT id, username, name, role, is_active, created_at
FROM users
WHERE username = 'admin';
-- =============================================================================
