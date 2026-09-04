-- Repair survey administrator identities that were created before the hardened
-- staff login started upgrading legacy password hashes. The public.users table
-- is read-only to API roles after the survey security migration, so this sync
-- can only be performed by the database migration role.

CREATE TEMP TABLE hader_changed_admin_identities (
  user_id UUID PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO hader_changed_admin_identities (user_id)
SELECT app_user.id
FROM public.users app_user
LEFT JOIN public.hader_survey_admin_identities identity
  ON identity.user_id = app_user.id
WHERE app_user.is_active = TRUE
  AND app_user.role IN ('site_admin', 'school_admin')
  AND (
    identity.user_id IS NULL
    OR identity.username IS DISTINCT FROM app_user.username
    OR identity.password_hash IS DISTINCT FROM app_user.password::TEXT
    OR identity.role IS DISTINCT FROM app_user.role
    OR identity.is_active IS DISTINCT FROM TRUE
  )
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO hader_changed_admin_identities (user_id)
SELECT identity.user_id
FROM public.hader_survey_admin_identities identity
WHERE NOT EXISTS (
  SELECT 1
  FROM public.users app_user
  WHERE app_user.id = identity.user_id
    AND app_user.username = identity.username
    AND app_user.is_active = TRUE
    AND app_user.role IN ('site_admin', 'school_admin')
)
ON CONFLICT (user_id) DO NOTHING;

-- A session minted against an older identity must not survive the repair.
DELETE FROM public.hader_survey_admin_sessions session
USING hader_changed_admin_identities changed
WHERE session.user_id = changed.user_id;

DELETE FROM public.hader_survey_admin_identities identity
WHERE NOT EXISTS (
  SELECT 1
  FROM public.users app_user
  WHERE app_user.id = identity.user_id
    AND app_user.username = identity.username
    AND app_user.is_active = TRUE
    AND app_user.role IN ('site_admin', 'school_admin')
);

INSERT INTO public.hader_survey_admin_identities (
  user_id,
  username,
  password_hash,
  role,
  is_active,
  login_attempts,
  locked_until
)
SELECT
  app_user.id,
  app_user.username,
  app_user.password::TEXT,
  app_user.role,
  TRUE,
  0,
  NULL
FROM public.users app_user
WHERE app_user.is_active = TRUE
  AND app_user.role IN ('site_admin', 'school_admin')
ON CONFLICT (user_id) DO UPDATE SET
  username = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  is_active = TRUE,
  login_attempts = 0,
  locked_until = NULL;

DROP TABLE hader_changed_admin_identities;
