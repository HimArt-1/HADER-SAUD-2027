-- =============================================================================
-- HADER - Guardian Login Security Table
-- =============================================================================
-- Legacy compatibility table. Guardian lockout is now enforced locally in the app
-- to avoid exposing a public lockout table to anon clients.
-- If you still need this table for administrative reporting, keep it private and
-- access it only through a trusted backend/service role.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS guardian_login_security (
    phone VARCHAR(20) PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_login_security_locked_until
    ON guardian_login_security (locked_until)
    WHERE locked_until IS NOT NULL;

ALTER TABLE guardian_login_security ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guardian_login_security_select_all" ON guardian_login_security;
DROP POLICY IF EXISTS "guardian_login_security_upsert_all" ON guardian_login_security;
DROP POLICY IF EXISTS "guardian_login_security_update_all" ON guardian_login_security;

REVOKE ALL ON TABLE guardian_login_security FROM anon;
REVOKE ALL ON TABLE guardian_login_security FROM authenticated;

COMMIT;
