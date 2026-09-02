-- Fix: search_students remained callable by anon because EXECUTE defaulted to PUBLIC.
-- Re-run safe if already applied (idempotent grants).

begin;

revoke all on function public.search_students(text, text, text, integer) from public;
grant execute on function public.search_students(text, text, text, integer) to authenticated;

commit;
