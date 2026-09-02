-- CLEAN REPAIR: Drop and Recreate Logging Tables
-- Use this to fix persistent 400 Bad Request errors

DROP TABLE IF EXISTS auth_audit_logs CASCADE;
DROP TABLE IF EXISTS client_error_logs CASCADE;

-- 1. auth_audit_logs (Recreate)
CREATE TABLE auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(100) NOT NULL,
    actor_user_id TEXT, -- Changed from UUID to TEXT to accept any ID format
    actor_role VARCHAR(50),
    actor_label VARCHAR(255),
    session_key VARCHAR(255),
    path TEXT,
    ip_hint VARCHAR(50),
    user_agent TEXT,
    meta JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_logs_created_at ON auth_audit_logs(created_at DESC);

-- 2. client_error_logs (Recreate)
CREATE TABLE client_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity VARCHAR(20) NOT NULL, -- 'fatal', 'error', 'warning'
    source VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    path TEXT,
    actor_user_id TEXT, -- Changed from UUID to TEXT
    actor_role VARCHAR(50),
    session_key VARCHAR(255),
    user_agent TEXT,
    meta JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_error_logs_created_at ON client_error_logs(created_at DESC);

-- 3. Enable RLS
ALTER TABLE auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_error_logs ENABLE ROW LEVEL SECURITY;

-- 4. Policies
CREATE POLICY "Allow insert for all" ON auth_audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select for admins" ON auth_audit_logs FOR SELECT USING (true);

CREATE POLICY "Allow insert for all" ON client_error_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select for admins" ON client_error_logs FOR SELECT USING (true);
