-- =============================================================================
-- نظام حاضر (Hader) - Missing Features Schema Update (v2.3)
-- 1. Dismissal System Tables (الانصراف والنداء)
-- 2. Storage Buckets (حاوية رفع الأعذار)
-- =============================================================================

-- =============================================================================
-- PART 1: DISMISSAL SYSTEM
-- =============================================================================

-- 1.1 سجلات الانصراف (Dismissal Records)
CREATE TABLE IF NOT EXISTS dismissal_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    dismissal_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method VARCHAR(50) CHECK (method IN ('kiosk', 'watcher', 'scanner', 'admin')),
    picked_up_by VARCHAR(255),
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_by_label VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dismissal_records_date ON dismissal_records(date);
CREATE INDEX IF NOT EXISTS idx_dismissal_records_student ON dismissal_records(student_id);

-- 1.2 طلبات نداء الانصراف (Dismissal Call Requests)
CREATE TABLE IF NOT EXISTS dismissal_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    student_name VARCHAR(255) NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    section VARCHAR(20) NOT NULL,
    requested_by VARCHAR(100), -- username (guardian username or supervisor ID)
    requested_by_name VARCHAR(255),
    status VARCHAR(50) CHECK (status IN ('pending', 'called', 'dismissed', 'cancelled')) DEFAULT 'pending',
    called_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Call Board real-time performance
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_status ON dismissal_calls(status) WHERE status IN ('pending', 'called');
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_date ON dismissal_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_student ON dismissal_calls(student_id);

-- 1.3 جداول مواعيد الانصراف للفصول (Dismissal Schedules)
CREATE TABLE IF NOT EXISTS dismissal_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_name VARCHAR(100) NOT NULL,
    dismissal_time TIME NOT NULL, -- HH:mm
    days INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4}', -- 0=Sun, 1=Mon...
    label VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- RLS POLICIES FOR DISMISSAL SYSTEM
-- =============================================================================

-- Enable RLS
ALTER TABLE dismissal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_schedules ENABLE ROW LEVEL SECURITY;

-- Kiosk/System Override (If you have a service role, this isn't strictly needed for server-side
-- but good practice to define explicit access for API clients)

DROP POLICY IF EXISTS "Permit all on dismissal_records for authenticated users" ON dismissal_records;
CREATE POLICY "Permit all on dismissal_records for authenticated users" 
    ON dismissal_records FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Permit all on dismissal_calls for authenticated users" ON dismissal_calls;
CREATE POLICY "Permit all on dismissal_calls for authenticated users" 
    ON dismissal_calls FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Permit all on dismissal_schedules for authenticated users" ON dismissal_schedules;
CREATE POLICY "Permit all on dismissal_schedules for authenticated users" 
    ON dismissal_schedules FOR ALL TO authenticated USING (true);

-- =============================================================================
-- PART 2: STORAGE BUCKETS
-- =============================================================================

-- 2.1 إنشاء حاوية (Bucket) الأعذار
-- Uses the internal storage.buckets table provided by Supabase
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'guardian-excuses',
  'guardian-excuses',
  true, -- Make it public so front-end can display images easily without presigned URLs
  false,
  5242880, -- 5MB limit
  '{"image/jpeg","image/png","image/webp","application/pdf"}'
) ON CONFLICT (id) DO NOTHING;

-- 2.2 RLS Policies for Storage
-- Requires the storage_policies to be defined in auth/storage context

-- Drop existing policies just in case
DROP POLICY IF EXISTS "Guardians can upload excuses" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view excuses" ON storage.objects;

-- Allow authenticated users (guardians) to insert files
CREATE POLICY "Guardians can upload excuses" 
    ON storage.objects FOR INSERT TO authenticated 
    WITH CHECK (bucket_id = 'guardian-excuses');

-- Allow anyone to read (since bucket is public)
CREATE POLICY "Anyone can view excuses" 
    ON storage.objects FOR SELECT TO public 
    USING (bucket_id = 'guardian-excuses');

-- Allow authenticated users to delete (e.g. for cleanup or users deleting their own)
DROP POLICY IF EXISTS "Users can delete excuses" ON storage.objects;
CREATE POLICY "Users can delete excuses"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'guardian-excuses');

-- =============================================================================
-- DONE!
-- Run this in your Supabase SQL Editor
-- =============================================================================
