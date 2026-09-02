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

CREATE INDEX IF NOT EXISTS idx_hader_surveys_created_at ON public.hader_surveys(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hader_survey_invitations_survey ON public.hader_survey_invitations(survey_id);
CREATE INDEX IF NOT EXISTS idx_hader_survey_responses_survey ON public.hader_survey_responses(survey_id, submitted_at DESC);

ALTER TABLE public.hader_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hader_survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hader_app_compat_access" ON public.hader_surveys;
CREATE POLICY "hader_app_compat_access" ON public.hader_surveys FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);
REVOKE ALL ON public.hader_survey_invitations, public.hader_survey_responses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hader_surveys TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.publish_hader_survey(
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
  IF jsonb_typeof(p_invitations) <> 'array' OR jsonb_array_length(p_invitations) = 0 THEN
    RAISE EXCEPTION 'حدد مستلماً واحداً على الأقل';
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

CREATE OR REPLACE FUNCTION public.get_hader_survey_bundle(p_survey_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'survey', to_jsonb(s),
    'invitations', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
      FROM public.hader_survey_invitations i
      WHERE i.survey_id = s.id
    ), '[]'::jsonb),
    'responses', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.submitted_at DESC)
      FROM public.hader_survey_responses r
      WHERE r.survey_id = s.id
    ), '[]'::jsonb)
  ) INTO result
  FROM public.hader_surveys s
  WHERE s.id = p_survey_id;
  RETURN result;
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
      'recipient_id', i.recipient_id,
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
      FOR option_value IN SELECT value FROM jsonb_array_elements(answer->'value')
      LOOP
        IF jsonb_typeof(option_value) <> 'string' OR NOT (question->'options' ? (option_value #>> '{}')) THEN
          RAISE EXCEPTION 'أحد الاختيارات غير صالح';
        END IF;
      END LOOP;
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

REVOKE ALL ON FUNCTION public.publish_hader_survey(UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_hader_survey_bundle(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_hader_survey(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_hader_survey_response(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_hader_survey(UUID, JSONB, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hader_survey_bundle(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_hader_survey(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_hader_survey_response(TEXT, JSONB) TO anon, authenticated;
