-- Purpose: Keep kiosk flow compatible with anon role.
-- Context: hardening migration revoked PUBLIC execute from search_students,
-- which broke kiosk ID lookup in deployments that still use anon key.

begin;

grant execute on function public.search_students(text, text, text, integer) to anon;

commit;
