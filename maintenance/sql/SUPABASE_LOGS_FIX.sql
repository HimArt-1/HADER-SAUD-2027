-- =============================================================================
-- FIX MIGRATION: Create missing logging tables
-- Run this in Supabase SQL Editor to fix the 400 Bad Request errors
-- =============================================================================

-- 1. auth_audit_logs
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(100) NOT NULL,
    actor_user_id UUID, -- Can be null if not logged in
    actor_role VARCHAR(50),
    actor_label VARCHAR(255),
    session_key VARCHAR(255),
    path TEXT,
    ip_hint VARCHAR(50),
    user_agent TEXT,
    meta JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_logs_created_at ON auth_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_logs_actor ON auth_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_auth_logs_action ON auth_audit_logs(action);

-- 2. client_error_logs
CREATE TABLE IF NOT EXISTS client_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity VARCHAR(20) NOT NULL, -- 'fatal', 'error', 'warning'
    source VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    path TEXT,
    actor_user_id UUID,
    actor_role VARCHAR(50),
    session_key VARCHAR(255),
    user_agent TEXT,
    meta JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON client_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON client_error_logs(severity);

-- 3. Enable RLS (Permissive for now to ensure logging works)
ALTER TABLE auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow insert for all" ON auth_audit_logs;
CREATE POLICY "Allow insert for all" ON auth_audit_logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow select for admins" ON auth_audit_logs;
CREATE POLICY "Allow select for admins" ON auth_audit_logs FOR SELECT USING (true); -- Adjust as needed

DROP POLICY IF EXISTS "Allow insert for all" ON client_error_logs;
CREATE POLICY "Allow insert for all" ON client_error_logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow select for admins" ON client_error_logs;
CREATE POLICY "Allow select for admins" ON client_error_logs FOR SELECT USING (true);
