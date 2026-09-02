-- Keep the password verification RPC working when pgcrypto lives outside public.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.verify_user_password(
    p_username TEXT,
    p_plain_password TEXT
) RETURNS TABLE (
    id UUID,
    username VARCHAR,
    role VARCHAR,
    password_match BOOLEAN
) SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.username,
        u.role,
        (u.password = crypt(p_plain_password, u.password::TEXT)) AS password_match
    FROM public.users u
    WHERE u.username = p_username;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
