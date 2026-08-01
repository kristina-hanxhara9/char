-- ============================================================
-- YOPEY Befriender — SAFE / IDEMPOTENT Supabase migration
-- ============================================================
-- Unlike supabase_setup.sql (which is a first-time install and errors with
-- "relation ... already exists" on a database that already has the tables),
-- this script is safe to run on a database that is EMPTY or PARTIALLY set up.
-- Every statement is guarded with IF NOT EXISTS, so you can paste the whole
-- thing into the Supabase SQL Editor and run it as many times as you like.
--
-- It creates only what a current deploy needs on top of the original schema:
--   * admin_users            (the new per-coordinator dashboard login)
--   * care_home_managers     (manager cross-check cache)
--   * school_postcodes       (+ precise lat/lng for walking distance)
--   * care_home_searches.origin_key column
--   * safeguarding_alerts    (in case this DB predates it)
-- and enables Row Level Security on each.
-- ============================================================

-- 1. Admin dashboard accounts (per-coordinator @yopey.org login)
CREATE TABLE IF NOT EXISTS admin_users (
    email TEXT PRIMARY KEY,                 -- lowercased @yopey.org address
    password_hash TEXT,                     -- pbkdf2_sha256$iters$salt$hash
    verified BOOLEAN DEFAULT FALSE,         -- true once the emailed code is confirmed
    verification_code_hash TEXT,            -- HMAC of the 6-digit code (nullable)
    code_expires_at TIMESTAMPTZ,            -- code TTL (nullable)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- 2. Manager cross-check cache (carehome.co.uk vs CQC register)
CREATE TABLE IF NOT EXISTS care_home_managers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    care_home_name TEXT NOT NULL,
    postcode TEXT,
    manager TEXT NOT NULL,
    source TEXT,
    verified BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_care_home_managers_name ON care_home_managers (LOWER(care_home_name));
CREATE INDEX IF NOT EXISTS idx_care_home_managers_postcode ON care_home_managers (postcode);

-- 3. School postcode cache (+ precise coordinates for walking distance)
CREATE TABLE IF NOT EXISTS school_postcodes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name_key TEXT UNIQUE NOT NULL,
    postcode TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE school_postcodes ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE school_postcodes ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- 4. Distance-origin column on the search cache
ALTER TABLE care_home_searches ADD COLUMN IF NOT EXISTS origin_key TEXT DEFAULT 'centroid';

-- 5. Safeguarding alerts (guard in case this DB predates it)
CREATE TABLE IF NOT EXISTS safeguarding_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'high',
    summary TEXT,
    trigger_message TEXT,
    notified_email BOOLEAN DEFAULT FALSE,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safeguarding_open
    ON safeguarding_alerts (created_at DESC) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_safeguarding_user ON safeguarding_alerts (user_id);

-- 6. Row Level Security on the tables above (backend uses service_role, which
--    bypasses RLS; this blocks the public anon key). Safe to re-run.
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_home_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_postcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE safeguarding_alerts ENABLE ROW LEVEL SECURITY;
