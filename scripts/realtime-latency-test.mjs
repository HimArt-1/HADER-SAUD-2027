import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function readEnvFile(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=');
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [key, value];
    });
  return Object.fromEntries(entries);
}

async function main() {
  const env = readEnvFile('.env');
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.log('REALTIME_TEST_FAILED={"reason":"missing_env"}');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey);

  const { data: students, error: studentError } = await supabase
    .from('students')
    .select('id')
    .limit(1);

  if (studentError || !students?.length) {
    console.log(
      `REALTIME_TEST_FAILED=${JSON.stringify({
        reason: 'no_student',
        message: studentError?.message || 'No students found'
      })}`
    );
    process.exit(1);
  }

  const studentId = students[0].id;
  const testId = crypto.randomUUID();
  const testDate = '2099-12-31';
  let insertDebug = null;

  const startedAt = Date.now();

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, reason: 'timeout' });
    }, 15000);

    const channel = supabase
      .channel(`latency_test_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_logs',
          filter: `id=eq.${testId}`
        },
        () => {
          clearTimeout(timeout);
          resolve({ ok: true, latencyMs: Date.now() - startedAt });
        }
      )
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;

        const { error: insertError } = await supabase.from('attendance_logs').insert({
          id: testId,
          student_id: studentId,
          date: testDate,
          timestamp: new Date().toISOString(),
          status: 'present',
          minutes_late: 0,
          recorded_by_label: 'latency-test',
          device_id: 'codex-latency-test'
        });

        if (insertError) {
          clearTimeout(timeout);
          resolve({
            ok: false,
            reason: 'insert_failed',
            code: insertError.code,
            message: insertError.message
          });
          return;
        }
        insertDebug = { ok: true };
      });
  });

  const { data: checkRow, error: checkError } = await supabase
    .from('attendance_logs')
    .select('id')
    .eq('id', testId)
    .maybeSingle();

  await supabase.from('attendance_logs').delete().eq('id', testId);

  if (result.ok) {
    console.log(`REALTIME_LATENCY_MS=${result.latencyMs}`);
    return;
  }

  console.log(
    `REALTIME_TEST_FAILED=${JSON.stringify({
      ...result,
      insertDebug,
      rowVisibleAfterInsert: Boolean(checkRow),
      visibilityError: checkError?.message || null
    })}`
  );
  process.exit(1);
}

main().catch((error) => {
  console.log(
    `REALTIME_TEST_FAILED=${JSON.stringify({
      reason: 'exception',
      message: error?.message || String(error)
    })}`
  );
  process.exit(1);
});
