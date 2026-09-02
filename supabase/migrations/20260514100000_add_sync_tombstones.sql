CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_tombstones_unique_record UNIQUE (table_name, record_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at
  ON public.sync_tombstones (deleted_at);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_table_record
  ON public.sync_tombstones (table_name, record_id);

ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_tombstones_allow_all" ON public.sync_tombstones;
CREATE POLICY "sync_tombstones_allow_all"
  ON public.sync_tombstones
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.sync_tombstones IS
  'Durable delete markers used by offline devices to remove records deleted while they were disconnected.';

NOTIFY pgrst, 'reload schema';
