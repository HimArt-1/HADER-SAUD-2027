#!/usr/bin/env python3
"""Exercise the real migration in a disposable, Unix-socket-only PostgreSQL cluster.

Requires PostgreSQL 15+ binaries and Python 3. No cloud credentials or database URL
are accepted. All tables, roles and forced disconnections belong to this cluster.
Usage: python3 scripts/verify-auto-absence-postgres.py --pg-bin /path/to/postgres/bin
"""
import argparse
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
TODAY = "(statement_timestamp() AT TIME ZONE 'Asia/Riyadh')::date"
LOCK = f"184721, {TODAY} - DATE '2000-01-01'"
RPC = "SELECT public.mark_hader_automatic_absence();"

# Minimal real column types/constraints from the current bootstrap and the
# attendance uniqueness migration. Supabase auth/storage are outside this test.
FIXTURE = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id=1), school_active boolean,
 system_ready boolean, absence_time text, work_days jsonb,
 attendance_settings jsonb, kiosk_settings jsonb);
CREATE TABLE public.students (id varchar(50) PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.attendance_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 student_id varchar(50) NOT NULL REFERENCES students(id), date date NOT NULL,
 timestamp timestamptz NOT NULL, status varchar(20) NOT NULL,
 minutes_late integer DEFAULT 0, recorded_by_label varchar(100), device_id varchar(100),
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 UNIQUE (student_id, date));
"""
RESET = """
TRUNCATE attendance_logs, students, settings;
INSERT INTO settings VALUES (1,true,true,'00:00','[0,1,2,3,4,5,6]', '{}', '{}');
INSERT INTO students VALUES ('missing',true);
"""


class Database:
    def __init__(self, bindir, directory):
        self.command = [str(bindir / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
                        '-h', str(directory), '-p', '55437', '-U', 'hader_test', '-d', 'postgres']
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}

    def sql(self, source, *, fail=False):
        result = subprocess.run(self.command, input=source, text=True, capture_output=True,
                                env=self.env, timeout=15)
        if fail:
            assert result.returncode != 0, 'Expected permission denial'
            return result.stderr
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def rpc(self):
        return json.loads(self.sql(RPC))

    def start(self, source, name):
        env = {**self.env, 'PGAPPNAME': name}
        return subprocess.Popen([*self.command, '-c', source], text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)

    def session(self, source):
        process = subprocess.Popen(self.command, text=True, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=self.env, bufsize=1)
        process.stdin.write(source + "\n\\echo READY\n")
        process.stdin.flush()
        # read line-by-line with a deadline, without sleeping to assume lock order
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        lines = []
        buffer = ''
        deadline = time.monotonic() + 10
        try:
            while time.monotonic() < deadline:
                if not selector.select(0.1):
                    continue
                chunk = os.read(process.stdout.fileno(), 65536).decode()
                if not chunk:
                    raise AssertionError(process.stderr.read())
                buffer += chunk
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if line == 'READY':
                        return process, lines
                    if line:
                        lines.append(line)
            raise AssertionError('Timed out waiting for database session')
        finally:
            selector.close()

    def finish(self, process, command='COMMIT;'):
        output, error = process.communicate(command + '\n\\q\n', timeout=10)
        assert process.returncode == 0, error
        return output

    def wait_for_lock(self, name):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if self.sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{name}' AND wait_event_type='Lock')") == 't':
                return
            time.sleep(0.025)
        raise AssertionError('RPC did not reach the expected concurrent insert lock')


def verify(db):
    passed = 0

    def ok(label):
        nonlocal passed
        passed += 1
        print(f'PASS {passed}: {label}', flush=True)

    db.sql(FIXTURE)
    migration = (ROOT / 'supabase/migrations/20260907090000_atomic_automatic_absence.sql').read_text()
    db.sql(migration)
    db.sql(migration)  # repeatable deployment
    db.sql(RESET)
    db.sql(f"""INSERT INTO students VALUES ('present',true),('late',true),('excused',true),('disabled',false);
      INSERT INTO attendance_logs (student_id,date,timestamp,status)
      SELECT id,{TODAY},now(),id FROM students WHERE id IN ('present','late','excused');""")
    result = db.rpc()
    assert result['completed'] and result['count'] == 1, result
    assert [r['student_id'] for r in result['records']] == ['missing'], result
    assert db.sql("SELECT string_agg(student_id || ':' || status, ',' ORDER BY student_id) FROM attendance_logs") == 'excused:excused,late:late,missing:absent,present:present'
    assert result['date'] == db.sql(f'SELECT {TODAY}'), result
    assert db.rpc()['count'] == 0
    ok('only unmarked active students; existing statuses preserved; repeat inserts zero')

    db.sql(RESET)
    holder, output = db.session(f"BEGIN; SELECT pg_backend_pid(); SELECT pg_advisory_xact_lock({LOCK});")
    pid = int(output[0])
    assert db.rpc()['reason'] == 'busy'
    # Terminate just the known test session. Its transaction lock must disappear.
    assert db.sql(f'SELECT pg_terminate_backend({pid})') == 't'
    holder.communicate('\\q\n', timeout=10)
    assert db.rpc()['count'] == 1
    ok('crashed lock holder cannot block automatic absence for the rest of the day')

    db.sql(RESET)
    holder, output = db.session('BEGIN; SELECT pg_backend_pid(); ' + RPC)
    assert json.loads(output[1])['count'] == 1
    assert db.sql('SELECT count(*) FROM attendance_logs') == '0'
    db.sql(f'SELECT pg_terminate_backend({int(output[0])})')
    holder.communicate('\\q\n', timeout=10)
    assert db.rpc()['count'] == 1
    ok('crash after insert rolls back the whole transaction; retry recovers')

    for decision in ('COMMIT', 'ROLLBACK'):
        db.sql(RESET)
        scanner, _ = db.session(f"BEGIN; INSERT INTO attendance_logs(student_id,date,timestamp,status) VALUES ('missing',{TODAY},now(),'present');")
        worker = db.start(RPC, 'hader_absence_race')
        db.wait_for_lock('hader_absence_race')
        db.finish(scanner, decision + ';')
        output, error = worker.communicate(timeout=10)
        assert worker.returncode == 0, error
        result = json.loads(output)
        expected_status = 'present' if decision == 'COMMIT' else 'absent'
        assert result['count'] == (0 if decision == 'COMMIT' else 1), result
        assert db.sql('SELECT status FROM attendance_logs') == expected_status
        ok(f'concurrent scanner {decision.lower()}: unique conflict preserves the correct record')

    db.sql(RESET)
    holder, output = db.session('BEGIN; ' + RPC)
    assert json.loads(output[0])['count'] == 1
    assert db.rpc()['reason'] == 'busy'
    db.finish(holder)
    assert db.rpc()['count'] == 0
    ok('two automatic processors cannot duplicate attendance')

    for setting, reason in [
        ("school_active=false", 'school_disabled'),
        ("system_ready=false", 'school_disabled'),
        ("absence_time='25:00'", 'invalid_cutoff'),
        ("attendance_settings='{" + '"work_days":[]' + "}'", 'holiday'),
        ("attendance_settings='{" + '"work_days":false' + "}'", 'invalid_calendar'),
        (f"attendance_settings=jsonb_build_object('academic_holidays',jsonb_build_array(jsonb_build_object('date',{TODAY})))", 'holiday')
    ]:
        db.sql(RESET + f'UPDATE settings SET {setting};')
        assert db.rpc()['reason'] == reason, (setting, reason)
        assert db.sql('SELECT count(*) FROM attendance_logs') == '0'
    db.sql(RESET + 'DELETE FROM students;')
    assert db.rpc()['reason'] == 'empty_roster'
    db.sql('DELETE FROM settings;')
    assert db.rpc()['reason'] == 'settings_missing'
    ok('school state, invalid settings, holidays, empty roster and missing settings prevent writes')

    # Compare the cutoff with the actual server clock without mocking PostgreSQL.
    db.sql(RESET + "UPDATE settings SET absence_time='23:59:59';")
    result = db.rpc()
    assert result.get('reason') == 'before_cutoff', result
    db.sql("UPDATE settings SET absence_time=NULL,kiosk_settings='{\"absence_time\":\"00:00\"}';")
    assert db.rpc()['count'] == 1
    ok('server cutoff and legacy kiosk settings fallback')

    db.sql(RESET)
    assert 'permission denied' in db.sql('SET ROLE anon; ' + RPC, fail=True)
    db.sql("""GRANT SELECT ON settings, students, attendance_logs TO anon;
      GRANT INSERT ON attendance_logs TO anon;
      ALTER TABLE students ENABLE ROW LEVEL SECURITY;
      ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY student_scope ON students FOR SELECT TO anon USING (id='missing');
      CREATE POLICY attendance_read ON attendance_logs FOR SELECT TO anon USING (student_id='missing');
      CREATE POLICY attendance_insert ON attendance_logs FOR INSERT TO anon WITH CHECK (student_id='missing');
      INSERT INTO students VALUES ('outside-scope',true);""")
    result = json.loads(db.sql('SET ROLE anon; ' + RPC))
    assert result['count'] == 1, result
    assert db.sql('SELECT student_id FROM attendance_logs') == 'missing'
    assert db.sql("SELECT prosecdef FROM pg_proc WHERE proname='mark_hader_automatic_absence'") == 'f'
    ok('invoker requires table privileges and obeys student/attendance RLS scope')
    print(f'All {passed} PostgreSQL integration scenarios passed.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path)
    args = parser.parse_args()
    bindir = args.pg_bin
    if not bindir:
        pg_config = shutil.which('pg_config')
        if not pg_config:
            parser.error('Install PostgreSQL 15+ or pass --pg-bin')
        bindir = Path(subprocess.check_output([pg_config, '--bindir'], text=True).strip())
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    with tempfile.TemporaryDirectory(prefix='hader-pg-', dir='/tmp') as temp:
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
            verify(Database(bindir, directory))
        finally:
            if (data / 'postmaster.pid').exists():
                subprocess.run([*ctl, '-m', 'immediate', '-w', 'stop'], check=True,
                               stdout=subprocess.DEVNULL, env=env, timeout=30)


if __name__ == '__main__':
    main()
