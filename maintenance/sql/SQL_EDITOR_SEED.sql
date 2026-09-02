-- بيانات أولية لتشغيل النظام في Supabase SQL Editor
-- هذا الملف يضيف سجلاً واحداً في جدول settings (id = 1).
-- يمكن تعديله قبل التشغيل حسب بيانات المدرسة.

INSERT INTO settings (
  id,
  system_ready,
  school_active,
  logo_url,
  school_name,
  principal_name,
  assembly_time,
  grace_period,
  dark_mode,
  kiosk_settings,
  notification_templates,
  social_links
) VALUES (
  1,
  TRUE,
  TRUE,
  '',
  '',
  '',
  '07:00',
  15,
  TRUE,
  '{"mainTitle":"نظام حاضر","subTitle":"يرجى تمرير البطاقة أو إدخال المعرف","earlyMessage":"مرحباً بك!","lateMessage":"لقد تأخرت عن التجمع","showStats":true,"theme":"dark-neon","camera_scan_enabled":true,"camera_scan_auto_open":false}',
  '{"late":{"title":"تنبيه تأخر","message":"نود إعلامكم بتأخر ابنكم/ابنتكم عن الحضور للمدرسة اليوم."},"absent":{"title":"تنبيه غياب","message":"نود إعلامكم بتغيب ابنكم/ابنتكم عن المدرسة اليوم."},"behavior":{"title":"ملاحظة سلوكية","message":"نود إعلامكم بتسجيل ملاحظة سلوكية على ابنكم/ابنتكم."},"summon":{"title":"استدعاء ولي أمر","message":"نرجو التكرم بمراجعة إدارة المدرسة."}}',
  '{"instagram":"","whatsapp":"","x":""}'
) ON CONFLICT (id) DO UPDATE SET
  system_ready = EXCLUDED.system_ready,
  school_active = EXCLUDED.school_active,
  logo_url = EXCLUDED.logo_url,
  school_name = EXCLUDED.school_name,
  principal_name = EXCLUDED.principal_name,
  assembly_time = EXCLUDED.assembly_time,
  grace_period = EXCLUDED.grace_period,
  dark_mode = EXCLUDED.dark_mode,
  kiosk_settings = EXCLUDED.kiosk_settings,
  notification_templates = EXCLUDED.notification_templates,
  social_links = EXCLUDED.social_links,
  updated_at = NOW();

-- يمكنك إضافة صفوف/فصول مبدئية عبر جدول classes عند الحاجة:
-- INSERT INTO classes (name, sections) VALUES ('أول', ARRAY['أ','ب']);
