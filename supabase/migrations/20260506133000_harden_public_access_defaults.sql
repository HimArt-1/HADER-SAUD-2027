begin;

create table if not exists public.guardian_login_security (
  phone varchar(20) primary key,
  attempts integer not null default 0,
  locked_until timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_guardian_login_security_locked_until
  on public.guardian_login_security (locked_until)
  where locked_until is not null;

alter table public.guardian_login_security enable row level security;

drop policy if exists "guardian_login_security_select_all" on public.guardian_login_security;
drop policy if exists "guardian_login_security_upsert_all" on public.guardian_login_security;
drop policy if exists "guardian_login_security_update_all" on public.guardian_login_security;

revoke all on table public.guardian_login_security from anon;
revoke all on table public.guardian_login_security from authenticated;

create or replace function public.search_students(
  p_query text default null,
  p_class_name text default null,
  p_section text default null,
  p_limit integer default 50
)
returns table(
  id text,
  name text,
  class_name text,
  section text,
  guardian_phone text,
  is_active boolean,
  attendance_rate numeric
) as $$
begin
  return query
  select
    s.id::text,
    s.name::text,
    s.class_name::text,
    s.section::text,
    null::text as guardian_phone,
    s.is_active,
    coalesce(
      (
        select round(
          (count(*) filter (where a.status in ('present', 'late'))::numeric / nullif(count(*), 0)) * 100,
          2
        )
        from public.attendance_logs a
        where a.student_id = s.id
          and a.date >= public.get_local_date() - interval '30 days'
      ),
      0
    ) as attendance_rate
  from public.students s
  where
    (p_query is null or s.name ilike '%' || p_query || '%' or s.id ilike '%' || p_query || '%')
    and (p_class_name is null or s.class_name = p_class_name)
    and (p_section is null or s.section = p_section)
  order by s.name
  limit p_limit;
end;
$$ language plpgsql;

-- Reverting hardening to make Kiosk work seamlessly without auth
grant execute on function public.search_students(text, text, text, integer) to public;
grant execute on function public.search_students(text, text, text, integer) to anon;
grant execute on function public.search_students(text, text, text, integer) to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'users'
  ) then
    execute 'alter publication supabase_realtime drop table public.users';
  end if;
end
$$;

commit;
