export type SyncConflictStrategy =
  | 'last_write_wins'
  | 'cloud_wins'
  | 'local_wins'
  | 'custom';

export type SyncTablePolicy = Readonly<{
  name: string;
  timestampColumn: string;
  upsertConflict?: string;
  conflictStrategy: SyncConflictStrategy;
  realtime: boolean;
}>;

const rawTablePolicies = [
  { name: 'students', timestampColumn: 'updated_at', upsertConflict: 'id', conflictStrategy: 'cloud_wins', realtime: true },
  { name: 'attendance_logs', timestampColumn: 'timestamp', upsertConflict: 'student_id,date', conflictStrategy: 'cloud_wins', realtime: true },
  { name: 'users', timestampColumn: 'updated_at', upsertConflict: 'username', conflictStrategy: 'cloud_wins', realtime: true },
  { name: 'classes', timestampColumn: 'updated_at', upsertConflict: 'name', conflictStrategy: 'cloud_wins', realtime: true },
  { name: 'settings', timestampColumn: 'updated_at', upsertConflict: 'id', conflictStrategy: 'local_wins', realtime: true },
  { name: 'exits', timestampColumn: 'created_at', conflictStrategy: 'last_write_wins', realtime: true },
  { name: 'violations', timestampColumn: 'created_at', conflictStrategy: 'last_write_wins', realtime: true },
  { name: 'notifications', timestampColumn: 'created_at', conflictStrategy: 'cloud_wins', realtime: true },
  { name: 'guardian_excuses', timestampColumn: 'updated_at', upsertConflict: 'id', conflictStrategy: 'last_write_wins', realtime: false },
  { name: 'dismissal_records', timestampColumn: 'dismissal_time', upsertConflict: 'id', conflictStrategy: 'last_write_wins', realtime: true },
  { name: 'dismissal_calls', timestampColumn: 'request_time', upsertConflict: 'id', conflictStrategy: 'last_write_wins', realtime: false },
  { name: 'dismissal_schedules', timestampColumn: 'updated_at', upsertConflict: 'id', conflictStrategy: 'cloud_wins', realtime: true },
  { name: 'activity_logs', timestampColumn: 'created_at', upsertConflict: 'id', conflictStrategy: 'last_write_wins', realtime: false },
  { name: 'auth_audit_logs', timestampColumn: 'created_at', conflictStrategy: 'last_write_wins', realtime: false },
  { name: 'client_error_logs', timestampColumn: 'created_at', upsertConflict: 'id', conflictStrategy: 'last_write_wins', realtime: false },
  { name: 'emergency_logs', timestampColumn: 'created_at', upsertConflict: 'id', conflictStrategy: 'last_write_wins', realtime: false },
  { name: 'daily_summaries', timestampColumn: 'updated_at', upsertConflict: 'date', conflictStrategy: 'last_write_wins', realtime: false }
] satisfies readonly SyncTablePolicy[];

const tablePolicies: readonly SyncTablePolicy[] = Object.freeze(
  rawTablePolicies.map(policy => Object.freeze(policy))
);

const policiesByName = new Map(tablePolicies.map(policy => [policy.name, policy]));
const realtimeTables = Object.freeze(
  tablePolicies.filter(policy => policy.realtime).map(policy => policy.name)
);

/**
 * The synchronization table interface. It keeps pull watermarks, upsert keys,
 * conflict policy and realtime eligibility at one seam.
 */
export const syncCatalog = Object.freeze({
  all(): readonly SyncTablePolicy[] {
    return tablePolicies;
  },

  realtime(): readonly string[] {
    return realtimeTables;
  },

  has(table: string): boolean {
    return policiesByName.has(table);
  },

  for(table: string): SyncTablePolicy {
    return policiesByName.get(table) ?? Object.freeze({
      name: table,
      timestampColumn: 'created_at',
      conflictStrategy: 'last_write_wins' as const,
      realtime: false
    });
  }
});
