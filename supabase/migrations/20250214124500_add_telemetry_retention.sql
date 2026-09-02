-- Telemetry retention configuration & cleanup scheduler

alter table settings
  add column if not exists telemetry_retention_days integer default 90;

create or replace function public.cleanup_telemetry_logs(retention_days int default 90)
returns json
language plpgsql
as $$
declare
  auth_deleted int := 0;
  error_deleted int := 0;
begin
  delete from public.auth_audit_logs
  where created_at < now() - make_interval(days => retention_days);
  get diagnostics auth_deleted = row_count;

  delete from public.client_error_logs
  where created_at < now() - make_interval(days => retention_days);
  get diagnostics error_deleted = row_count;

  return json_build_object(
    'auth_deleted', auth_deleted,
    'error_deleted', error_deleted
  );
end;
$$;

do $do$
declare
  job_id int;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into job_id from cron.job where jobname = 'telemetry-cleanup';
    if job_id is not null then
      perform cron.unschedule(job_id);
    end if;
    perform cron.schedule(
      'telemetry-cleanup',
      '30 0 * * *',
      'select public.cleanup_telemetry_logs(90);'
    );
  end if;
end
$do$;
