-- Add priority column to notifications table if it doesn't exist
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- Index for priority if needed (optional but good for specific queries)
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
