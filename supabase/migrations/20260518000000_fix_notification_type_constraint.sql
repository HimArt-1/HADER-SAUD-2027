-- Fix the notifications_type_check constraint to include new types like attendance and dismissal_call
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('announcement', 'behavior', 'general', 'command', 'alert', 'attendance', 'dismissal_call'));

-- Also ensure target_audience has all expected values
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_target_audience_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_target_audience_check CHECK (target_audience IN ('all', 'admin', 'supervisor', 'guardian', 'kiosk', 'class', 'student', 'user'));
