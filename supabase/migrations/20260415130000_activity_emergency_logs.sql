-- Optional sync tables used by SyncService (pull 404 if missing)
-- Idempotent: safe to re-run

create table if not exists public.activity_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.users (id),
    user_name text,
    action text not null,
    description text,
    target_id text,
    target_name text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz default now()
);

create table if not exists public.emergency_logs (
    id uuid primary key default gen_random_uuid(),
    type text not null,
    message text,
    status text default 'active',
    created_at timestamptz default now(),
    resolved_at timestamptz,
    resolved_by uuid references public.users (id)
);

create index if not exists idx_activity_logs_created_at on public.activity_logs (created_at);
create index if not exists idx_emergency_logs_created_at on public.emergency_logs (created_at);

alter table public.activity_logs enable row level security;
alter table public.emergency_logs enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'activity_logs' and policyname = 'activity_logs_allow_all'
    ) then
        create policy "activity_logs_allow_all" on public.activity_logs
            for all using (true) with check (true);
    end if;
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'emergency_logs' and policyname = 'emergency_logs_allow_all'
    ) then
        create policy "emergency_logs_allow_all" on public.emergency_logs
            for all using (true) with check (true);
    end if;
end $$;
