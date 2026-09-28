#!/usr/bin/env python3
"""Verify legacy account migration and real administrator RPCs on local PostgreSQL.

Uses a disposable Unix-socket-only cluster, never a cloud database or credentials.
Usage: python3 scripts/verify-user-management-postgres.py [--pg-bin /path/to/bin]
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_pg', Path(__file__).with_name('verify-auto-absence-postgres.py'))
local_pg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local_pg)

MIGRATION = ROOT / 'supabase/migrations/20260928090000_fix_users_assigned_classes_type.sql'
SITE_ID = '11111111-1111-4111-8111-111111111111'
SCHOOL_ID = '22222222-2222-4222-8222-222222222222'
LEGACY_ID = '33333333-3333-4333-8333-333333333333'

FIXTURE = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE public.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username varchar(100) UNIQUE NOT NULL,
 password varchar(500) NOT NULL, password_hash_version integer NOT NULL DEFAULT 1,
 name varchar(255) NOT NULL, role varchar(50) NOT NULL,
 assigned_classes text[] DEFAULT '{}'::text[], assigned_sections text[] DEFAULT '{}'::text[],
 email varchar(255), phone varchar(20), is_active boolean NOT NULL DEFAULT true,
 can_use_whatsapp boolean NOT NULL DEFAULT false, last_login timestamptz,
 login_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
INSERT INTO public.users(id,username,password,name,role,assigned_classes) VALUES
 ('11111111-1111-4111-8111-111111111111','system.test',extensions.crypt('SystemTest88',extensions.gen_salt('bf',4)),'نظام','site_admin',NULL),
 ('22222222-2222-4222-8222-222222222222','school.test',extensions.crypt('SchoolTest88',extensions.gen_salt('bf',4)),'مدير','school_admin','{}'),
 ('33333333-3333-4333-8333-333333333333','DH',extensions.crypt('LegacyTest88',extensions.gen_salt('bf',4)),'مشرف','supervisor_class',ARRAY['الأول','الثاني']);
"""


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def verify(db):
    passed = 0

    def ok(label):
        nonlocal passed
        passed += 1
        print(f'PASS {passed}: {label}', flush=True)

    db.sql(FIXTURE)
    db.sql((ROOT / 'supabase/migrations/20260902090000_add_surveys.sql').read_text())

    def session(username, password):
        return json.loads(db.sql('SET ROLE service_role; SELECT public.create_hader_survey_admin_session('
                                + quote(username) + ',' + quote(password) + ');'))['token']

    token = session('school.test', 'SchoolTest88')

    def save(payload, session_token=token, fail=False):
        source = 'SET ROLE anon; SELECT public.save_hader_user(' + quote(session_token) + ',' + quote(json.dumps(payload)) + '::jsonb);'
        result = db.sql(source, fail=fail)
        return result if fail else json.loads(result)

    password_hash = db.sql("SELECT extensions.crypt('CreatedTest88',extensions.gen_salt('bf',4));")
    draft = dict(username='created.test', name='حساب اختبار', role='school_admin', password=password_hash, assigned_classes=None)
    failure = save(draft, fail=True)
    assert 'assigned_classes' in failure and 'text[]' in failure and 'jsonb' in failure
    assert db.sql("SELECT count(*) FROM users WHERE username='created.test'") == '0'
    ok('reproduces the production type error without inserting a partial account')

    failure = db.sql("BEGIN; ALTER TABLE users ALTER COLUMN assigned_classes TYPE jsonb USING to_jsonb(assigned_classes); ROLLBACK;", fail=True)
    assert 'default' in failure and 'jsonb' in failure
    ok('reproduces legacy array-default conversion failure')

    before = json.loads(db.sql('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u;'))
    access_sql = """SELECT jsonb_build_object(
      'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='users'::regclass),
      'acl',(SELECT jsonb_agg(jsonb_build_object('name',attname,'acl',attacl) ORDER BY attname) FROM pg_attribute WHERE attrelid='users'::regclass AND attnum>0),
      'function',md5(pg_get_functiondef('public.save_hader_user(text,jsonb)'::regprocedure)));"""
    original_access = db.sql(access_sql)
    db.sql(MIGRATION.read_text())
    after = json.loads(db.sql('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u;'))
    expected = [{**row, 'assigned_classes': row['assigned_classes'] or []} for row in before]
    assert after == expected
    assert original_access == db.sql(access_sql)
    assert db.sql("SELECT pg_typeof(assigned_classes) FROM users LIMIT 1") == 'jsonb'
    ok('preserves existing accounts, passwords, class labels, RLS and column privileges')

    db.sql(MIGRATION.read_text())
    assert after == json.loads(db.sql('SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u;'))
    assert db.sql("SELECT column_default FROM information_schema.columns WHERE table_name='users' AND column_name='assigned_classes'") == "'[]'::jsonb"
    ok('migration is repeatable and sets the JSONB array default')

    roles = ['school_admin', 'supervisor_global', 'supervisor_class', 'watcher', 'kiosk', 'call_station']
    accounts = {}
    for role in roles:
        assignments = [{'class_name': 'الأول', 'sections': ['أ', 'ب']}] if role == 'supervisor_class' else None
        account = save({**draft, 'username': 'test.' + role, 'role': role, 'assigned_classes': assignments})
        assert account['role'] == role
        assert account['assigned_classes'] == (assignments or [])
        assert not {'password', 'password_hash_version', 'login_attempts', 'locked_until'} & account.keys()
        accounts[role] = account
    ok('school administrator can create all six staff roles, including structured class/section scope')

    legacy_hash = db.sql('SELECT password FROM users WHERE id=' + quote(LEGACY_ID))
    edited = save(dict(id=LEGACY_ID, username='DH', name='مشرف محدّث', role='supervisor_class',
                      assigned_classes=[{'class_name': 'الأول', 'sections': ['ب']}], assigned_sections=['ب'], can_use_whatsapp=True))
    assert db.sql('SELECT password FROM users WHERE id=' + quote(LEGACY_ID)) == legacy_hash
    assert edited['assigned_classes'][0]['sections'] == ['ب'] and edited['assigned_sections'] == ['ب']
    assert edited['can_use_whatsapp'] is True
    ok('editing legacy usernames and permissions preserves an omitted password')

    replacement_hash = db.sql("SELECT extensions.crypt('Replacement88',extensions.gen_salt('bf',4));")
    save({**edited, 'password': replacement_hash})
    assert db.sql("SET ROLE service_role; SELECT authenticate_hader_staff('DH','LegacyTest88') IS NULL") == 't'
    assert db.sql("SET ROLE service_role; SELECT authenticate_hader_staff('DH','Replacement88')->'user'->>'id'") == LEGACY_ID
    ok('password reset accepts the new password and rejects the old password')

    manager = save({**accounts['watcher'], 'role': 'school_admin'})
    promoted_token = session(manager['username'], 'CreatedTest88')
    save({**manager, 'role': 'watcher'})
    assert 'جلسة' in save({**draft, 'username': 'invalid.promoted'}, promoted_token, fail=True)
    ok('promotion creates an admin identity and demotion invalidates its administrative session')

    for invalid in [
        {**draft, 'role': 'site_admin'},
        {**draft, 'id': SITE_ID, 'role': 'school_admin'},
        {**draft, 'id': SCHOOL_ID, 'role': 'watcher'},
        {**draft, 'id': SCHOOL_ID, 'is_active': False}
    ]:
        assert 'ERROR' in save(invalid, fail=True)
    assert 'جلسة' in save(draft, 'invalid-session', fail=True)
    assert 'permission denied' in db.sql("SET ROLE anon; INSERT INTO users(username,password,name,role) VALUES ('direct','x','x','school_admin')", fail=True)
    ok('server still rejects privilege escalation, self-lockout, invalid sessions and direct writes')

    created_id = accounts['kiosk']['id']
    db.sql('SET ROLE anon; SELECT delete_hader_user(' + quote(token) + ',' + quote(created_id) + '::uuid);')
    assert db.sql('SELECT count(*) FROM users WHERE id=' + quote(created_id)) == '0'
    ok('school administrator can delete a managed account through the authenticated RPC')
    print(f'All {passed} PostgreSQL user-management scenarios passed.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path)
    args = parser.parse_args()
    if args.pg_bin:
        bindir = args.pg_bin
    else:
        pg_config = shutil.which('pg_config')
        if not pg_config:
            parser.error('Install PostgreSQL 15+ or pass --pg-bin')
        bindir = Path(subprocess.check_output([pg_config, '--bindir'], text=True).strip())
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    with tempfile.TemporaryDirectory(prefix='hader-users-pg-', dir='/tmp') as temp:
        directory = Path(temp).resolve()
        data = directory / 'data'
        subprocess.run([str(bindir / 'initdb'), '-D', str(data), '-U', 'hader_test',
                        '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8'],
                       check=True, stdout=subprocess.DEVNULL, env=env, timeout=30)
        ctl = [str(bindir / 'pg_ctl'), '-D', str(data)]
        try:
            subprocess.run([*ctl, '-l', str(directory / 'server.log'), '-o',
                            f"-k {directory} -p 55437 -h ''", '-w', 'start'],
                           check=True, stdout=subprocess.DEVNULL, env=env, timeout=30)
            verify(local_pg.Database(bindir, directory))
        finally:
            if (data / 'postmaster.pid').exists():
                subprocess.run([*ctl, '-m', 'immediate', '-w', 'stop'], check=True,
                               stdout=subprocess.DEVNULL, env=env, timeout=30)


if __name__ == '__main__':
    main()
