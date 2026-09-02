import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260902090000_add_surveys.sql'),
  'utf8'
);

describe('survey security migration', () => {
  it('makes the legacy users table read-only to API roles', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "hader_app_compat_access" ON public.users');
    expect(migration).toContain('CREATE POLICY "hader_users_read_only" ON public.users');
    expect(migration).toContain('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.save_hader_user');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.delete_hader_user');
  });

  it('keeps authentication free of attacker-triggered account lockouts', () => {
    expect(migration).not.toContain('hader_survey_auth_rate_limits');
    expect(migration).not.toContain('login_attempts = COALESCE(login_attempts, 0) + 1');
    expect(migration).toContain('$2a$12$mtyPvXM07dLYOXXTr6zffuYS0YSYzmTudT.qa/QGC2Xc5nU2gaK0O');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.consume_hader_auth_edge_rate_limit');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.authenticate_hader_staff(TEXT, TEXT) TO service_role');
    expect(migration).not.toContain('GRANT EXECUTE ON FUNCTION public.authenticate_hader_staff(TEXT, TEXT) TO anon');
  });

  it('serializes user administration to preserve the final site administrator', () => {
    expect(migration.match(/pg_advisory_xact_lock\(71423698501\)/g)).toHaveLength(2);
    expect(migration).toContain('لا يمكن تعطيل آخر مدير نظام');
    expect(migration).toContain('لا يمكن حذف آخر مدير نظام');
  });
});
