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
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hader_surveys_created_at ON public.hader_surveys(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hader_survey_invitations_survey ON public.hader_survey_invitations(survey_id);
CREATE INDEX IF NOT EXISTS idx_hader_survey_responses_survey ON public.hader_survey_responses(survey_id, submitted_at DESC);

ALTER TABLE public.hader_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_admin_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hader_app_compat_access" ON public.hader_surveys;
REVOKE ALL ON public.hader_surveys, public.hader_survey_invitations, public.hader_survey_responses, public.hader_survey_admin_sessions FROM anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.create_hader_survey_admin_session(p_username TEXT, p_plain_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  admin_user public.users%ROWTYPE;
  raw_token TEXT;
BEGIN
  SELECT * INTO admin_user FROM public.users
  WHERE username = p_username
    AND is_active = TRUE
    AND role IN ('site_admin', 'school_admin');
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF admin_user.locked_until IS NOT NULL AND admin_user.locked_until > now() THEN
    RETURN NULL;
  END IF;
  IF NOT public.verify_hader_survey_password(admin_user.password::TEXT, p_plain_password) THEN
    UPDATE public.users SET
      login_attempts = COALESCE(login_attempts, 0) + 1,
      locked_until = CASE WHEN COALESCE(login_attempts, 0) + 1 >= 5 THEN now() + interval '30 minutes' ELSE locked_until END
    WHERE id = admin_user.id;
    RETURN NULL;
  END IF;
  UPDATE public.users SET login_attempts = 0, locked_until = NULL WHERE id = admin_user.id;
  DELETE FROM public.hader_survey_admin_sessions WHERE expires_at <= now();
  raw_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.hader_survey_admin_sessions (token_hash, user_id, expires_at)
  VALUES (digest(raw_token, 'sha256'), admin_user.id, now() + interval '8 hours');
  RETURN raw_token;
END;
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
  JOIN public.users admin_user ON admin_user.id = session.user_id
  WHERE session.token_hash = digest(COALESCE(p_session_token, ''), 'sha256')
    AND session.expires_at > now()
    AND admin_user.is_active = TRUE
    AND admin_user.role IN ('site_admin', 'school_admin');
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
BEGIN
  admin_id := public.require_hader_survey_admin(p_session_token);
  survey_id := (p_survey->>'id')::UUID;
  IF EXISTS (SELECT 1 FROM public.hader_surveys WHERE id = survey_id AND status <> 'draft') THEN
    RAISE EXCEPTION 'لا يمكن تعديل استبيان منشور';
  END IF;
  IF jsonb_typeof(p_survey->'questions') <> 'array' OR jsonb_array_length(p_survey->'questions') = 0 THEN
    RAISE EXCEPTION 'أضف سؤالاً واحداً على الأقل';
  END IF;
  INSERT INTO public.hader_surveys (
    id, title, description, audience, status, anonymous, closes_at, questions,
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
  SET status = 'published', published_at = COALESCE(p_published_at, now()), updated_at = now()
  WHERE id = p_survey_id AND status = 'draft';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'الاستبيان غير موجود أو سبق نشره'; END IF;

  FOR invitation IN SELECT value FROM jsonb_array_elements(p_invitations)
  LOOP
    INSERT INTO public.hader_survey_invitations (
      id, survey_id, token, recipient_id, recipient_name, recipient_contact,
      recipient_detail, responded_at, created_at
    ) VALUES (
      (invitation->>'id')::UUID,
      p_survey_id,
      invitation->>'token',
      invitation->>'recipient_id',
      invitation->>'recipient_name',
      COALESCE(invitation->>'recipient_contact', ''),
      COALESCE(invitation->>'recipient_detail', ''),
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
          THEN to_jsonb(i) || jsonb_build_object(
            'responded_at', CASE WHEN i.responded_at IS NULL THEN NULL ELSE '1970-01-01T00:00:00.000Z' END
          )
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
      'responded_at', i.responded_at,
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
  IF invitation.responded_at IS NOT NULL THEN RAISE EXCEPTION 'تم إرسال الإجابة مسبقاً'; END IF;

  SELECT * INTO survey FROM public.hader_surveys WHERE id = invitation.survey_id;
  IF survey.status <> 'published' THEN RAISE EXCEPTION 'هذا الاستبيان غير متاح لاستقبال الإجابات'; END IF;
  IF survey.closes_at IS NOT NULL AND now() > survey.closes_at THEN RAISE EXCEPTION 'انتهت مدة الاستبيان'; END IF;
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
      jsonb_typeof(answer->'value') <> 'number' OR (answer->>'value')::NUMERIC < 1 OR (answer->>'value')::NUMERIC > 5
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
    ) THEN
      RAISE EXCEPTION 'أجب عن جميع الأسئلة المطلوبة';
    END IF;
  END LOOP;

  INSERT INTO public.hader_survey_responses (survey_id, invitation_id, respondent_name, answers)
  VALUES (survey.id, invitation.id, CASE WHEN survey.anonymous THEN NULL ELSE invitation.recipient_name END, p_answers)
  RETURNING * INTO response_row;
  UPDATE public.hader_survey_invitations SET responded_at = response_row.submitted_at WHERE id = invitation.id;
  RETURN to_jsonb(response_row);
END;
$$;

REVOKE ALL ON FUNCTION public.hader_bytea_xor(BYTEA, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_hader_survey_password(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_hader_survey_admin_session(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_hader_survey_admin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_hader_surveys(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_hader_survey_draft(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_hader_survey(TEXT, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_hader_survey_bundle(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_hader_survey(TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_hader_survey_draft(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_hader_survey(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_hader_survey_response(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hader_survey_admin_session(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_hader_surveys(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_hader_survey_draft(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_hader_survey(TEXT, UUID, JSONB, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hader_survey_bundle(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_hader_survey(TEXT, UUID, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_hader_survey_draft(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_hader_survey(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_hader_survey_response(TEXT, JSONB) TO anon, authenticated;
