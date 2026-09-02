ALTER TABLE public.exits
  ADD COLUMN IF NOT EXISTS requester_relation TEXT,
  ADD COLUMN IF NOT EXISTS requester_relation_other TEXT;

DO $$
BEGIN
  ALTER TABLE public.exits
    ADD CONSTRAINT exits_requester_relation_check
    CHECK (
      requester_relation IS NULL OR
      requester_relation IN ('father', 'mother', 'brother', 'sister', 'driver', 'other')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.exits.requester_relation IS
  'Relationship of the person who requested permission for the student to leave.';

COMMENT ON COLUMN public.exits.requester_relation_other IS
  'Custom relationship text when requester_relation is other.';

NOTIFY pgrst, 'reload schema';
