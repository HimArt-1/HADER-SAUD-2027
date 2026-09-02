-- Hader surveys: drafts, targeted invitations and one response per recipient.
CREATE TABLE IF NOT EXISTS public.hader_surveys (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL CHECK (audience IN ('guardians', 'teachers')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  closes_at TIMESTAMPTZ,
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) > 0),
  draft_recipients JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(draft_recipients) = 'array'),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.hader_survey_invitations (
  id UUID PRIMARY KEY,
  survey_id UUID NOT NULL REFERENCES public.hader_surveys(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE CHECK (length(token) >= 20),
  recipient_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_contact TEXT NOT NULL DEFAULT '',
  recipient_detail TEXT NOT NULL DEFAULT '',
  queued_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS public.hader_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES public.hader_surveys(id) ON DELETE CASCADE,
  invitation_id UUID NOT NULL UNIQUE REFERENCES public.hader_survey_invitations(id) ON DELETE CASCADE,
  respondent_name TEXT,
  answers JSONB NOT NULL CHECK (jsonb_typeof(answers) = 'array'),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hader_survey_admin_sessions (
  token_hash BYTEA PRIMARY KEY,
  user_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Isolated snapshot of the administrators allowed to manage surveys. The legacy
-- application exposes public.users to its anon client, so survey authorization
-- must not trust later client-side mutations to that table.
CREATE TABLE IF NOT EXISTS public.hader_survey_admin_identities (
  user_id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('site_admin', 'school_admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hader_auth_edge_rate_limits (
  key_hash BYTEA PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.hader_survey_admin_identities (user_id, username, password_hash, role)
SELECT id, username, password::TEXT, role
FROM public.users
WHERE is_active = TRUE AND role IN ('site_admin', 'school_admin')
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_hader_surveys_created_at ON public.hader_surveys(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hader_survey_invitations_survey ON public.hader_survey_invitations(survey_id);
CREATE INDEX IF NOT EXISTS idx_hader_survey_responses_survey ON public.hader_survey_responses(survey_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hader_auth_edge_rate_limits_window ON public.hader_auth_edge_rate_limits(window_started_at);

ALTER TABLE public.hader_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_admin_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_auth_edge_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hader_app_compat_access" ON public.hader_surveys;
REVOKE ALL ON public.hader_surveys, public.hader_survey_invitations, public.hader_survey_responses, public.hader_survey_admin_sessions, public.hader_survey_admin_identities, public.hader_auth_edge_rate_limits FROM anon, authenticated;
DROP POLICY IF EXISTS "hader_app_compat_access" ON public.users;
DROP POLICY IF EXISTS "hader_users_read_only" ON public.users;
CREATE POLICY "hader_users_read_only" ON public.users
  FOR SELECT TO anon, authenticated USING (TRUE);
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;
GRANT SELECT (
  id, username, name, role, assigned_classes, assigned_sections, email, phone,
  is_active, can_use_whatsapp, last_login, created_at, updated_at
) ON public.users TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.hader_bytea_xor(left_value BYTEA, right_value BYTEA)
RETURNS BYTEA
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  result BYTEA := left_value;
  index_value INTEGER;
BEGIN
  IF length(left_value) <> length(right_value) THEN RAISE EXCEPTION 'تعذر التحقق من كلمة المرور'; END IF;
  FOR index_value IN 0..length(left_value) - 1 LOOP
    result := set_byte(result, index_value, get_byte(left_value, index_value) # get_byte(right_value, index_value));
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_hader_survey_password(stored_password TEXT, plain_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  pieces TEXT[];
  iteration_count INTEGER;
  salt_value BYTEA;
  expected_hash TEXT;
  block_value BYTEA;
  derived_value BYTEA;
  iteration_index INTEGER;
BEGIN
  IF stored_password IS NULL OR plain_password IS NULL THEN RETURN FALSE; END IF;
  IF stored_password LIKE '$2%' THEN RETURN crypt(plain_password, stored_password) = stored_password; END IF;
  pieces := string_to_array(stored_password, ':');
  IF array_length(pieces, 1) <> 3 OR pieces[1] !~ '^\d+$' THEN
    RETURN stored_password = plain_password;
  END IF;
  iteration_count := pieces[1]::INTEGER;
  IF iteration_count < 1 OR iteration_count > 200000 THEN RETURN FALSE; END IF;
  salt_value := decode(pieces[2], 'hex');
  expected_hash := lower(pieces[3]);
  block_value := hmac(salt_value || int4send(1), convert_to(plain_password, 'UTF8'), 'sha256');
  derived_value := block_value;
  FOR iteration_index IN 2..iteration_count LOOP
    block_value := hmac(block_value, convert_to(plain_password, 'UTF8'), 'sha256');
    derived_value := public.hader_bytea_xor(derived_value, block_value);
  END LOOP;
  RETURN lower(encode(derived_value, 'hex')) = expected_hash;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_hader_auth_edge_rate_limit(p_source TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  source_attempts INTEGER;
  global_attempts INTEGER;
BEGIN
  IF length(COALESCE(p_source, '')) < 8 OR length(p_source) > 200 THEN RETURN FALSE; END IF;
  DELETE FROM public.hader_auth_edge_rate_limits
  WHERE window_started_at < now() - interval '24 hours';

  INSERT INTO public.hader_auth_edge_rate_limits (key_hash, window_started_at, attempts)
  VALUES (digest('source:' || p_source, 'sha256'), now(), 1)
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN public.hader_auth_edge_rate_limits.window_started_at < now() - interval '5 minutes' THEN now()
      ELSE public.hader_auth_edge_rate_limits.window_started_at
    END,
    attempts = CASE
      WHEN public.hader_auth_edge_rate_limits.window_started_at < now() - interval '5 minutes' THEN 1
      ELSE public.hader_auth_edge_rate_limits.attempts + 1
    END
  RETURNING attempts INTO source_attempts;

  INSERT INTO public.hader_auth_edge_rate_limits (key_hash, window_started_at, attempts)
  VALUES (digest('global', 'sha256'), now(), 1)
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN public.hader_auth_edge_rate_limits.window_started_at < now() - interval '5 minutes' THEN now()
      ELSE public.hader_auth_edge_rate_limits.window_started_at
    END,
    attempts = CASE
      WHEN public.hader_auth_edge_rate_limits.window_started_at < now() - interval '5 minutes' THEN 1
      ELSE public.hader_auth_edge_rate_limits.attempts + 1
    END
  RETURNING attempts INTO global_attempts;

  RETURN source_attempts <= 10 AND global_attempts <= 1000;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_hader_survey_admin_session(p_username TEXT, p_plain_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  admin_user public.hader_survey_admin_identities%ROWTYPE;
  raw_token TEXT;
  session_expiry TIMESTAMPTZ;
BEGIN
  SELECT identity.* INTO admin_user
  FROM public.hader_survey_admin_identities identity
  JOIN public.users app_user ON app_user.id = identity.user_id
  WHERE identity.username = p_username
    AND identity.is_active = TRUE
    AND app_user.is_active = TRUE
    AND app_user.role IN ('site_admin', 'school_admin')
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.verify_hader_survey_password(
      '$2a$12$mtyPvXM07dLYOXXTr6zffuYS0YSYzmTudT.qa/QGC2Xc5nU2gaK0O',
      COALESCE(p_plain_password, '')
    );
    RETURN NULL;
  END IF;
  IF NOT public.verify_hader_survey_password(admin_user.password_hash, p_plain_password) THEN
    RETURN NULL;
  END IF;
  UPDATE public.hader_survey_admin_identities SET login_attempts = 0, locked_until = NULL WHERE user_id = admin_user.user_id;
  DELETE FROM public.hader_survey_admin_sessions WHERE expires_at <= now();
  raw_token := encode(gen_random_bytes(32), 'hex');
  session_expiry := now() + interval '8 hours';
  INSERT INTO public.hader_survey_admin_sessions (token_hash, user_id, expires_at)
  VALUES (digest(raw_token, 'sha256'), admin_user.user_id, session_expiry);
  RETURN jsonb_build_object('token', raw_token, 'expiresAt', session_expiry);
END;
$$;

CREATE OR REPLACE FUNCTION public.authenticate_hader_staff(p_username TEXT, p_plain_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  staff_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO staff_user FROM public.users
  WHERE username = p_username AND is_active = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.verify_hader_survey_password(
      '$2a$12$mtyPvXM07dLYOXXTr6zffuYS0YSYzmTudT.qa/QGC2Xc5nU2gaK0O',
      COALESCE(p_plain_password, '')
    );
    RETURN NULL;
  END IF;
  IF NOT public.verify_hader_survey_password(staff_user.password::TEXT, p_plain_password) THEN
    RETURN NULL;
  END IF;
  UPDATE public.users SET
    password = CASE
      WHEN staff_user.password::TEXT LIKE '$2%' THEN staff_user.password
      ELSE crypt(p_plain_password, gen_salt('bf', 12))
    END,
    password_hash_version = 1,
    login_attempts = 0,
    locked_until = NULL,
    last_login = now()
  WHERE id = staff_user.id;
  RETURN jsonb_build_object('user', jsonb_build_object(
    'id', staff_user.id,
    'username', staff_user.username,
    'name', staff_user.name,
    'role', staff_user.role,
    'assigned_classes', staff_user.assigned_classes,
    'assigned_sections', staff_user.assigned_sections,
    'email', staff_user.email,
    'phone', staff_user.phone,
    'is_active', staff_user.is_active,
    'can_use_whatsapp', staff_user.can_use_whatsapp
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_hader_survey_admin_session(p_session_token TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  DELETE FROM public.hader_survey_admin_sessions
  WHERE token_hash = digest(COALESCE(p_session_token, ''), 'sha256');
$$;

CREATE OR REPLACE FUNCTION public.require_hader_survey_admin(p_session_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  admin_id UUID;
BEGIN
  SELECT session.user_id INTO admin_id
  FROM public.hader_survey_admin_sessions session
  JOIN public.hader_survey_admin_identities admin_user ON admin_user.user_id = session.user_id
  JOIN public.users app_user ON app_user.id = session.user_id
  WHERE session.token_hash = digest(COALESCE(p_session_token, ''), 'sha256')
    AND session.expires_at > now()
    AND admin_user.is_active = TRUE
    AND admin_user.role IN ('site_admin', 'school_admin')
    AND app_user.is_active = TRUE
    AND app_user.role IN ('site_admin', 'school_admin');
  IF admin_id IS NULL THEN RAISE EXCEPTION 'جلسة إدارة الاستبيانات غير صالحة أو منتهية'; END IF;
  RETURN admin_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hader_surveys(p_session_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM public.require_hader_survey_admin(p_session_token);
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO result FROM public.hader_surveys s;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_hader_user(p_session_token TEXT, p_user JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller_id UUID;
  caller_role TEXT;
  target_id UUID;
  target_role TEXT;
  target_active BOOLEAN;
  incoming_password TEXT;
  existing_user public.users%ROWTYPE;
  saved_user public.users%ROWTYPE;
BEGIN
  caller_id := public.require_hader_survey_admin(p_session_token);
  PERFORM pg_advisory_xact_lock(71423698501);
  SELECT role INTO caller_role FROM public.users WHERE id = caller_id AND is_active = TRUE;
  IF caller_role NOT IN ('site_admin', 'school_admin') THEN RAISE EXCEPTION 'ليست لديك صلاحية إدارة المستخدمين'; END IF;

  target_id := COALESCE(NULLIF(p_user->>'id', '')::UUID, gen_random_uuid());
  target_role := p_user->>'role';
  target_active := COALESCE((p_user->>'is_active')::BOOLEAN, TRUE);
  incoming_password := NULLIF(p_user->>'password', '');
  SELECT * INTO existing_user FROM public.users WHERE id = target_id FOR UPDATE;

  IF length(btrim(COALESCE(p_user->>'username', ''))) = 0 OR length(p_user->>'username') > 100
    OR length(btrim(COALESCE(p_user->>'name', ''))) = 0 OR length(p_user->>'name') > 255
    OR target_role NOT IN ('site_admin', 'school_admin', 'supervisor_global', 'supervisor_class', 'watcher', 'kiosk', 'guardian', 'call_station')
    OR length(COALESCE(p_user->>'email', '')) > 255
    OR length(COALESCE(p_user->>'phone', '')) > 20
    OR (p_user ? 'assigned_classes' AND p_user->'assigned_classes' <> 'null'::JSONB AND jsonb_typeof(p_user->'assigned_classes') <> 'array')
    OR (p_user ? 'assigned_sections' AND p_user->'assigned_sections' <> 'null'::JSONB AND jsonb_typeof(p_user->'assigned_sections') <> 'array') THEN
    RAISE EXCEPTION 'بيانات المستخدم غير صالحة';
  END IF;
  IF existing_user.id IS NULL AND incoming_password IS NULL THEN RAISE EXCEPTION 'كلمة المرور مطلوبة للمستخدم الجديد'; END IF;
  IF incoming_password IS NOT NULL AND length(incoming_password) > 500 THEN RAISE EXCEPTION 'كلمة المرور غير صالحة'; END IF;
  IF caller_role = 'school_admin' AND (target_role = 'site_admin' OR existing_user.role = 'site_admin') THEN
    RAISE EXCEPTION 'مدير المدرسة لا يستطيع إدارة حساب مدير النظام';
  END IF;
  IF target_id = caller_id AND (target_active IS NOT TRUE OR target_role <> caller_role) THEN
    RAISE EXCEPTION 'لا يمكنك تعطيل حسابك الحالي أو تغيير صلاحيته';
  END IF;
  IF existing_user.role = 'site_admin' AND (target_role <> 'site_admin' OR target_active IS NOT TRUE)
    AND (SELECT count(*) FROM public.users WHERE role = 'site_admin' AND is_active = TRUE) <= 1 THEN
    RAISE EXCEPTION 'لا يمكن تعطيل آخر مدير نظام';
  END IF;

  INSERT INTO public.users (
    id, username, password, password_hash_version, name, role, assigned_classes,
    assigned_sections, email, phone, is_active, can_use_whatsapp, created_at, updated_at
  ) VALUES (
    target_id,
    btrim(p_user->>'username'),
    COALESCE(incoming_password, existing_user.password::TEXT),
    1,
    btrim(p_user->>'name'),
    target_role,
    COALESCE(NULLIF(p_user->'assigned_classes', 'null'::JSONB), '[]'::JSONB),
    CASE
      WHEN p_user->'assigned_sections' IS NULL OR p_user->'assigned_sections' = 'null'::JSONB THEN '{}'::TEXT[]
      ELSE ARRAY(SELECT jsonb_array_elements_text(p_user->'assigned_sections'))
    END,
    NULLIF(p_user->>'email', ''),
    NULLIF(p_user->>'phone', ''),
    target_active,
    COALESCE((p_user->>'can_use_whatsapp')::BOOLEAN, FALSE),
    COALESCE(NULLIF(p_user->>'created_at', '')::TIMESTAMPTZ, now()),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    password = COALESCE(incoming_password, public.users.password),
    password_hash_version = CASE WHEN incoming_password IS NULL THEN public.users.password_hash_version ELSE 1 END,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    assigned_classes = EXCLUDED.assigned_classes,
    assigned_sections = EXCLUDED.assigned_sections,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    is_active = EXCLUDED.is_active,
    can_use_whatsapp = EXCLUDED.can_use_whatsapp,
    updated_at = now()
  RETURNING * INTO saved_user;

  IF saved_user.is_active AND saved_user.role IN ('site_admin', 'school_admin') THEN
    INSERT INTO public.hader_survey_admin_identities (user_id, username, password_hash, role, is_active)
    VALUES (saved_user.id, saved_user.username, saved_user.password::TEXT, saved_user.role, TRUE)
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      is_active = TRUE,
      login_attempts = 0,
      locked_until = NULL;
    DELETE FROM public.hader_survey_admin_sessions
    WHERE user_id = saved_user.id
      AND token_hash <> digest(COALESCE(p_session_token, ''), 'sha256');
  ELSE
    DELETE FROM public.hader_survey_admin_sessions WHERE user_id = saved_user.id;
    DELETE FROM public.hader_survey_admin_identities WHERE user_id = saved_user.id;
  END IF;

  RETURN to_jsonb(saved_user)
    - 'password' - 'password_hash_version' - 'login_attempts' - 'locked_until';
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_hader_user(p_session_token TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id UUID;
  caller_role TEXT;
  target_user public.users%ROWTYPE;
BEGIN
  caller_id := public.require_hader_survey_admin(p_session_token);
  PERFORM pg_advisory_xact_lock(71423698501);
  SELECT role INTO caller_role FROM public.users WHERE id = caller_id AND is_active = TRUE;
  SELECT * INTO target_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_user_id = caller_id THEN RAISE EXCEPTION 'لا يمكنك حذف الحساب المستخدم حالياً'; END IF;
  IF caller_role = 'school_admin' AND target_user.role = 'site_admin' THEN
    RAISE EXCEPTION 'مدير المدرسة لا يستطيع حذف مدير النظام';
  END IF;
  IF target_user.role = 'site_admin'
    AND (SELECT count(*) FROM public.users WHERE role = 'site_admin' AND is_active = TRUE) <= 1 THEN
    RAISE EXCEPTION 'لا يمكن حذف آخر مدير نظام';
  END IF;
  DELETE FROM public.hader_survey_admin_sessions WHERE user_id = p_user_id;
  DELETE FROM public.hader_survey_admin_identities WHERE user_id = p_user_id;
  DELETE FROM public.users WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_hader_survey_draft(p_session_token TEXT, p_survey JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id UUID;
  saved public.hader_surveys%ROWTYPE;
  survey_id UUID;
  question JSONB;
  recipient JSONB;
  seen_question_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  admin_id := public.require_hader_survey_admin(p_session_token);
  survey_id := (p_survey->>'id')::UUID;
  IF EXISTS (SELECT 1 FROM public.hader_surveys WHERE id = survey_id AND status <> 'draft') THEN
    RAISE EXCEPTION 'لا يمكن تعديل استبيان منشور';
  END IF;
  IF length(btrim(COALESCE(p_survey->>'title', ''))) = 0 OR length(btrim(p_survey->>'title')) > 200 THEN
    RAISE EXCEPTION 'عنوان الاستبيان مطلوب ولا يتجاوز 200 حرف';
  END IF;
  IF length(COALESCE(p_survey->>'description', '')) > 4000 OR p_survey->>'audience' NOT IN ('guardians', 'teachers') THEN
    RAISE EXCEPTION 'وصف الاستبيان أو جمهوره غير صالح';
  END IF;
  IF jsonb_typeof(p_survey->'questions') <> 'array' OR jsonb_array_length(p_survey->'questions') = 0 THEN
    RAISE EXCEPTION 'أضف سؤالاً واحداً على الأقل';
  END IF;
  IF jsonb_array_length(p_survey->'questions') > 100 OR length((p_survey->'questions')::TEXT) > 262144 THEN
    RAISE EXCEPTION 'عدد الأسئلة أو حجمها يتجاوز الحد المسموح';
  END IF;
  FOR question IN SELECT value FROM jsonb_array_elements(p_survey->'questions') LOOP
    IF jsonb_typeof(question) <> 'object'
      OR length(btrim(COALESCE(question->>'id', ''))) = 0
      OR length(question->>'id') > 100
      OR length(btrim(COALESCE(question->>'prompt', ''))) = 0
      OR length(question->>'prompt') > 500
      OR question->>'type' NOT IN ('single_choice', 'multiple_choice', 'rating', 'yes_no', 'text')
      OR jsonb_typeof(question->'required') <> 'boolean'
      OR jsonb_typeof(question->'options') <> 'array' THEN
      RAISE EXCEPTION 'بنية أحد أسئلة الاستبيان غير صالحة';
    END IF;
    IF question->>'id' = ANY(seen_question_ids) THEN RAISE EXCEPTION 'معرفات الأسئلة يجب ألا تتكرر'; END IF;
    seen_question_ids := array_append(seen_question_ids, question->>'id');
    IF question->>'type' IN ('single_choice', 'multiple_choice') AND (
      jsonb_array_length(question->'options') < 2
      OR jsonb_array_length(question->'options') > 50
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(question->'options') option_value(value)
        WHERE jsonb_typeof(value) <> 'string'
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(question->'options') option_value(value)
        WHERE length(btrim(value)) = 0 OR length(value) > 200
      )
      OR (SELECT count(*) FROM jsonb_array_elements_text(question->'options')) <>
         (SELECT count(DISTINCT lower(btrim(value))) FROM jsonb_array_elements_text(question->'options') option_value(value))
    ) THEN
      RAISE EXCEPTION 'خيارات أحد أسئلة الاستبيان غير صالحة';
    END IF;
  END LOOP;
  IF jsonb_typeof(COALESCE(p_survey->'draft_recipients', '[]'::JSONB)) <> 'array'
    OR jsonb_array_length(COALESCE(p_survey->'draft_recipients', '[]'::JSONB)) > 10000
    OR length(COALESCE(p_survey->'draft_recipients', '[]'::JSONB)::TEXT) > 5242880 THEN
    RAISE EXCEPTION 'قائمة مستلمي المسودة غير صالحة أو تتجاوز الحد المسموح';
  END IF;
  FOR recipient IN SELECT value FROM jsonb_array_elements(COALESCE(p_survey->'draft_recipients', '[]'::JSONB)) LOOP
    IF jsonb_typeof(recipient) <> 'object'
      OR jsonb_typeof(recipient->'id') <> 'string'
      OR jsonb_typeof(recipient->'name') <> 'string'
      OR jsonb_typeof(COALESCE(recipient->'contact', '""'::JSONB)) <> 'string'
      OR jsonb_typeof(COALESCE(recipient->'detail', '""'::JSONB)) <> 'string'
      OR length(btrim(COALESCE(recipient->>'id', ''))) = 0
      OR length(recipient->>'id') > 200
      OR length(btrim(COALESCE(recipient->>'name', ''))) = 0
      OR length(recipient->>'name') > 255
      OR length(COALESCE(recipient->>'contact', '')) > 30
      OR length(COALESCE(recipient->>'detail', '')) > 1000 THEN
      RAISE EXCEPTION 'بيانات أحد مستلمي المسودة غير صالحة';
    END IF;
  END LOOP;
  INSERT INTO public.hader_surveys (
    id, title, description, audience, status, anonymous, closes_at, questions, draft_recipients,
    created_by, created_at, updated_at, published_at
  ) VALUES (
    survey_id,
    btrim(p_survey->>'title'),
    COALESCE(p_survey->>'description', ''),
    p_survey->>'audience',
    'draft',
    COALESCE((p_survey->>'anonymous')::BOOLEAN, FALSE),
    NULLIF(p_survey->>'closes_at', '')::TIMESTAMPTZ,
    p_survey->'questions',
    COALESCE(p_survey->'draft_recipients', '[]'::JSONB),
    admin_id::TEXT,
    COALESCE((p_survey->>'created_at')::TIMESTAMPTZ, now()),
    now(),
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    audience = EXCLUDED.audience,
    anonymous = EXCLUDED.anonymous,
    closes_at = EXCLUDED.closes_at,
    questions = EXCLUDED.questions,
    draft_recipients = EXCLUDED.draft_recipients,
    updated_at = now()
  RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_hader_survey(
  p_session_token TEXT,
  p_survey_id UUID,
  p_invitations JSONB,
  p_published_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invitation JSONB;
  changed INTEGER;
BEGIN
  PERFORM public.require_hader_survey_admin(p_session_token);
  IF jsonb_typeof(p_invitations) <> 'array' OR jsonb_array_length(p_invitations) = 0 THEN
    RAISE EXCEPTION 'حدد مستلماً واحداً على الأقل';
  END IF;
  IF jsonb_array_length(p_invitations) > 10000 OR length(p_invitations::TEXT) > 5242880 THEN
    RAISE EXCEPTION 'عدد الدعوات أو حجمها يتجاوز الحد المسموح';
  END IF;

  UPDATE public.hader_surveys
  SET status = 'published', draft_recipients = '[]'::JSONB, published_at = COALESCE(p_published_at, now()), updated_at = now()
  WHERE id = p_survey_id AND status = 'draft';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'الاستبيان غير موجود أو سبق نشره'; END IF;

  FOR invitation IN SELECT value FROM jsonb_array_elements(p_invitations)
  LOOP
    INSERT INTO public.hader_survey_invitations (
      id, survey_id, token, recipient_id, recipient_name, recipient_contact,
      recipient_detail, queued_at, responded_at, created_at
    ) VALUES (
      (invitation->>'id')::UUID,
      p_survey_id,
      invitation->>'token',
      invitation->>'recipient_id',
      invitation->>'recipient_name',
      COALESCE(invitation->>'recipient_contact', ''),
      COALESCE(invitation->>'recipient_detail', ''),
      NULL,
      NULL,
      COALESCE((invitation->>'created_at')::TIMESTAMPTZ, now())
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hader_survey_bundle(p_session_token TEXT, p_survey_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM public.require_hader_survey_admin(p_session_token);
  SELECT jsonb_build_object(
    'survey', to_jsonb(s),
    'invitations', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN s.anonymous
          THEN to_jsonb(i) || jsonb_build_object('responded_at', NULL)
          ELSE to_jsonb(i)
        END
        ORDER BY i.created_at
      )
      FROM public.hader_survey_invitations i
      WHERE i.survey_id = s.id
    ), '[]'::jsonb),
    'responses', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN s.anonymous
          THEN (to_jsonb(r) - 'invitation_id' - 'respondent_name') || jsonb_build_object(
            'submitted_at', date_trunc('day', r.submitted_at)
          )
          ELSE to_jsonb(r)
        END
        ORDER BY r.submitted_at DESC
      )
      FROM public.hader_survey_responses r
      WHERE r.survey_id = s.id
    ), '[]'::jsonb)
  ) INTO result
  FROM public.hader_surveys s
  WHERE s.id = p_survey_id;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_hader_survey(
  p_session_token TEXT,
  p_survey_id UUID,
  p_updated_at TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved public.hader_surveys%ROWTYPE;
BEGIN
  PERFORM public.require_hader_survey_admin(p_session_token);
  UPDATE public.hader_surveys
  SET status = 'closed', updated_at = COALESCE(p_updated_at, now())
  WHERE id = p_survey_id AND status = 'published'
  RETURNING * INTO saved;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'الاستبيان غير موجود أو غير منشور'; END IF;
  RETURN to_jsonb(saved);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_hader_survey_invitations_queued(
  p_session_token TEXT,
  p_invitation_ids UUID[],
  p_queued_at TIMESTAMPTZ DEFAULT now()
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_hader_survey_admin(p_session_token);
  IF COALESCE(array_length(p_invitation_ids, 1), 0) > 500 THEN
    RAISE EXCEPTION 'حجم دفعة الإرسال يتجاوز الحد المسموح';
  END IF;
  UPDATE public.hader_survey_invitations invitation
  SET queued_at = COALESCE(p_queued_at, now()),
      recipient_id = CASE WHEN survey.anonymous THEN 'anonymous:' || invitation.id::TEXT ELSE invitation.recipient_id END,
      recipient_name = CASE WHEN survey.anonymous THEN 'مستلم مجهول' ELSE invitation.recipient_name END,
      recipient_contact = CASE WHEN survey.anonymous THEN '' ELSE invitation.recipient_contact END,
      recipient_detail = CASE WHEN survey.anonymous THEN '' ELSE invitation.recipient_detail END
  FROM public.hader_surveys survey
  WHERE invitation.id = ANY(COALESCE(p_invitation_ids, ARRAY[]::UUID[]))
    AND survey.id = invitation.survey_id
    AND survey.status = 'published'
    AND (survey.closes_at IS NULL OR survey.closes_at > now());
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_hader_survey_draft(p_session_token TEXT, p_survey_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed INTEGER;
BEGIN
  PERFORM public.require_hader_survey_admin(p_session_token);
  DELETE FROM public.hader_surveys WHERE id = p_survey_id AND status = 'draft';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'لا يمكن حذف إلا مسودة موجودة'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_hader_survey(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'survey', jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'description', s.description,
      'audience', s.audience,
      'status', s.status,
      'anonymous', s.anonymous,
      'closes_at', s.closes_at,
      'questions', s.questions,
      'created_at', s.created_at,
      'updated_at', s.updated_at,
      'published_at', s.published_at
    ),
    'invitation', jsonb_build_object(
      'id', i.id,
      'survey_id', i.survey_id,
      'token', i.token,
      'recipient_id', '',
      'recipient_name', CASE WHEN s.anonymous THEN 'مستلم' ELSE i.recipient_name END,
      'responded_at', CASE WHEN s.anonymous THEN NULL ELSE i.responded_at END,
      'created_at', i.created_at
    )
  ) INTO result
  FROM public.hader_survey_invitations i
  JOIN public.hader_surveys s ON s.id = i.survey_id
  WHERE i.token = p_token;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_hader_survey_response(p_token TEXT, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invitation public.hader_survey_invitations%ROWTYPE;
  survey public.hader_surveys%ROWTYPE;
  question JSONB;
  answer JSONB;
  option_value JSONB;
  response_row public.hader_survey_responses%ROWTYPE;
BEGIN
  SELECT * INTO invitation FROM public.hader_survey_invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'رابط الاستبيان غير صالح أو منتهي'; END IF;

  SELECT * INTO survey FROM public.hader_surveys WHERE id = invitation.survey_id;
  IF invitation.responded_at IS NOT NULL AND survey.anonymous IS NOT TRUE THEN RAISE EXCEPTION 'تم إرسال الإجابة مسبقاً'; END IF;
  IF survey.status <> 'published' THEN RAISE EXCEPTION 'هذا الاستبيان غير متاح لاستقبال الإجابات'; END IF;
  IF survey.closes_at IS NOT NULL AND now() >= survey.closes_at THEN RAISE EXCEPTION 'انتهت مدة الاستبيان'; END IF;
  IF jsonb_typeof(p_answers) <> 'array' THEN RAISE EXCEPTION 'صيغة الإجابات غير صالحة'; END IF;
  IF jsonb_array_length(p_answers) > jsonb_array_length(survey.questions) OR length(p_answers::TEXT) > 65536 THEN
    RAISE EXCEPTION 'حجم الإجابات يتجاوز الحد المسموح';
  END IF;

  FOR answer IN SELECT value FROM jsonb_array_elements(p_answers)
  LOOP
    SELECT value INTO question FROM jsonb_array_elements(survey.questions) q WHERE q->>'id' = answer->>'questionId';
    IF question IS NULL THEN
      RAISE EXCEPTION 'تحتوي الإجابة سؤالاً غير صالح';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(p_answers) a WHERE a->>'questionId' = answer->>'questionId') > 1 THEN
      RAISE EXCEPTION 'توجد إجابة مكررة للسؤال نفسه';
    END IF;
    IF question->>'type' = 'text' AND jsonb_typeof(answer->'value') <> 'string' THEN
      RAISE EXCEPTION 'صيغة الإجابة النصية غير صالحة';
    ELSIF question->>'type' = 'yes_no' AND jsonb_typeof(answer->'value') <> 'boolean' THEN
      RAISE EXCEPTION 'صيغة إجابة نعم أو لا غير صالحة';
    ELSIF question->>'type' = 'rating' AND (
      jsonb_typeof(answer->'value') <> 'number'
      OR (answer->>'value')::NUMERIC < 1
      OR (answer->>'value')::NUMERIC > 5
      OR trunc((answer->>'value')::NUMERIC) <> (answer->>'value')::NUMERIC
    ) THEN
      RAISE EXCEPTION 'التقييم يجب أن يكون بين 1 و5';
    ELSIF question->>'type' = 'single_choice' AND (
      jsonb_typeof(answer->'value') <> 'string' OR NOT (question->'options' ? (answer->>'value'))
    ) THEN
      RAISE EXCEPTION 'خيار الإجابة غير صالح';
    ELSIF question->>'type' = 'multiple_choice' THEN
      IF jsonb_typeof(answer->'value') <> 'array' THEN RAISE EXCEPTION 'صيغة الاختيارات غير صالحة'; END IF;
      IF jsonb_array_length(answer->'value') > jsonb_array_length(question->'options') OR (
        SELECT count(*) FROM jsonb_array_elements_text(answer->'value') AS choices(value)
      ) <> (
        SELECT count(DISTINCT value) FROM jsonb_array_elements_text(answer->'value') AS choices(value)
      ) THEN
        RAISE EXCEPTION 'تحتوي الإجابة اختيارات مكررة أو زائدة';
      END IF;
      FOR option_value IN SELECT value FROM jsonb_array_elements(answer->'value')
      LOOP
        IF jsonb_typeof(option_value) <> 'string' OR NOT (question->'options' ? (option_value #>> '{}')) THEN
          RAISE EXCEPTION 'أحد الاختيارات غير صالح';
        END IF;
      END LOOP;
    ELSIF question->>'type' = 'text' AND length(answer->>'value') > 4000 THEN
      RAISE EXCEPTION 'الإجابة النصية تتجاوز الحد المسموح';
    END IF;
    question := NULL;
  END LOOP;

  FOR question IN SELECT value FROM jsonb_array_elements(survey.questions)
  LOOP
    IF COALESCE((question->>'required')::BOOLEAN, FALSE) AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_answers) a
      WHERE a->>'questionId' = question->>'id'
        AND a ? 'value'
        AND a->'value' <> 'null'::jsonb
        AND a->'value' <> '""'::jsonb
        AND a->'value' <> '[]'::jsonb
        AND (jsonb_typeof(a->'value') <> 'string' OR length(btrim(a->>'value')) > 0)
    ) THEN
      RAISE EXCEPTION 'أجب عن جميع الأسئلة المطلوبة';
    END IF;
  END LOOP;

  IF invitation.responded_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', '',
      'survey_id', survey.id,
      'invitation_id', '',
      'respondent_name', NULL,
      'answers', '[]'::JSONB,
      'submitted_at', date_trunc('day', now())
    );
  END IF;

  INSERT INTO public.hader_survey_responses (survey_id, invitation_id, respondent_name, answers)
  VALUES (survey.id, invitation.id, CASE WHEN survey.anonymous THEN NULL ELSE invitation.recipient_name END, p_answers)
  RETURNING * INTO response_row;
  UPDATE public.hader_survey_invitations SET responded_at = response_row.submitted_at WHERE id = invitation.id;
  IF survey.anonymous THEN
    RETURN jsonb_build_object(
      'id', '',
      'survey_id', survey.id,
      'invitation_id', '',
      'respondent_name', NULL,
      'answers', '[]'::JSONB,
      'submitted_at', date_trunc('day', now())
    );
  END IF;
  RETURN to_jsonb(response_row);
END;
$$;

REVOKE ALL ON FUNCTION public.hader_bytea_xor(BYTEA, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_hader_survey_password(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_hader_auth_edge_rate_limit(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_hader_survey_admin_session(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authenticate_hader_staff(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_hader_auth_edge_rate_limit(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_hader_survey_admin_session(TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.authenticate_hader_staff(TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_hader_survey_admin_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_hader_survey_admin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_hader_surveys(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_hader_user(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_hader_user(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_hader_survey_draft(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_hader_survey(TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_hader_survey_bundle(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_hader_survey_invitations_queued(TEXT, UUID[], TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_hader_survey(TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_hader_survey_draft(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_hader_survey(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_hader_survey_response(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_hader_auth_edge_rate_limit(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_hader_survey_admin_session(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.authenticate_hader_staff(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_hader_survey_admin_session(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_hader_surveys(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_hader_user(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_hader_user(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_hader_survey_draft(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_hader_survey(TEXT, UUID, JSONB, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hader_survey_bundle(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_hader_survey_invitations_queued(TEXT, UUID[], TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_hader_survey(TEXT, UUID, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_hader_survey_draft(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_hader_survey(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_hader_survey_response(TEXT, JSONB) TO anon, authenticated;
