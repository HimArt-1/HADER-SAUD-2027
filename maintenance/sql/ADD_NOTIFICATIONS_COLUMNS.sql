-- ═══════════════════════════════════════════════════════════════
-- إضافة الأعمدة المفقودة لجدول الإشعارات (notifications)
-- شغّل هذا الملف في Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. إضافة عمود is_popup إن لم يكن موجوداً
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_popup BOOLEAN DEFAULT FALSE;

-- 2. إضافة عمود priority إن لم يكن موجوداً
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- 3. إضافة عمود is_read إن لم يكن موجوداً
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- 4. إضافة عمود expires_at إن لم يكن موجوداً
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 5. إضافة عمود created_by إن لم يكن موجوداً
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- فهارس مفيدة
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_is_popup ON notifications(is_popup) WHERE is_popup = TRUE;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read) WHERE is_read = FALSE;
