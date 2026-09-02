-- Add telemetry tables for support dashboards

create table if not exists auth_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  action text not null check (action in ('LOGIN', 'LOGOUT', 'SESSION_RESTORE', 'SESSION_EXPIRED')),
  actor_user_id uuid null,
  actor_role text null,
  actor_label text not null default 'anonymous',
  session_key text not null,
  path text not null default '',
  ip_hint text null,
  user_agent text not null,
  meta jsonb null
);

create index if not exists idx_auth_audit_logs_created_at on auth_audit_logs (created_at desc);
create index if not exists idx_auth_audit_logs_action on auth_audit_logs (action);

create table if not exists client_error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  severity text not null check (severity in ('ERROR', 'WARN')),
  source text not null check (source in ('window.onerror', 'unhandledrejection', 'react-boundary', 'console.error')),
  message text not null,
  stack text null,
  path text not null default '',
  actor_user_id uuid null,
  actor_role text null,
  session_key text not null,
  user_agent text not null,
  meta jsonb null
);

create index if not exists idx_client_error_logs_created_at on client_error_logs (created_at desc);
create index if not exists idx_client_error_logs_severity on client_error_logs (severity);

alter table auth_audit_logs enable row level security;
alter table client_error_logs enable row level security;

drop policy if exists "auth_audit_logs_select_site_admin" on auth_audit_logs;
create policy "auth_audit_logs_select_site_admin"
  on auth_audit_logs
  for select
  using ((auth.jwt() ->> 'role') = 'site_admin');

drop policy if exists "auth_audit_logs_insert_public" on auth_audit_logs;
create policy "auth_audit_logs_insert_public"
  on auth_audit_logs
  for insert
  with check (true);

drop policy if exists "client_error_logs_select_site_admin" on client_error_logs;
create policy "client_error_logs_select_site_admin"
  on client_error_logs
  for select
  using ((auth.jwt() ->> 'role') = 'site_admin');

drop policy if exists "client_error_logs_insert_public" on client_error_logs;
create policy "client_error_logs_insert_public"
  on client_error_logs
  for insert
  with check (true);
