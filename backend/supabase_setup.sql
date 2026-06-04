-- ============================================================
-- YOPEY Befriender — Supabase Database Setup
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. USERS — every young person who chats with the bot
CREATE TABLE users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    first_name TEXT NOT NULL,
    surname TEXT,
    email TEXT UNIQUE,
    age INTEGER NOT NULL CHECK (age >= 16),
    postcode TEXT,
    school TEXT,
    stage TEXT,                                  -- 'sixth_form' or 'undergraduate'
    utm_source TEXT,                             -- optional: where the signup came from
    status TEXT DEFAULT 'new',                   -- new → searching → contacted → waiting → matched → active
    -- Post-acceptance email drip: 0=not matched, 1=welcome sent, 2=approach tips,
    -- 3=convo starters, 4=going deeper, 5=one-month check-in
    post_match_stage INTEGER DEFAULT 0,
    matched_at TIMESTAMPTZ,                      -- when status first became 'matched'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- 2. CONTACTS — tracks which care homes they've reached out to
CREATE TABLE contacts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    care_home_name TEXT NOT NULL,
    care_home_phone TEXT,
    care_home_address TEXT,
    method TEXT,                                 -- 'email', 'phone', 'in_person'
    contacted_at TIMESTAMPTZ DEFAULT NOW(),
    nudge_stage INTEGER DEFAULT 0,               -- 0=none, 1=day3, 2=day5, 3=day7, 4=day10
    reply_received BOOLEAN DEFAULT FALSE,
    outcome TEXT,                                -- NULL (waiting), 'accepted', 'rejected'
    notes TEXT
);

CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_waiting ON contacts(reply_received, nudge_stage)
    WHERE reply_received = FALSE;

-- 3. CONVERSATIONS — chat history so the bot remembers between sessions
CREATE TABLE conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    messages JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TRAINING PROGRESS — which dementia resources they've completed
CREATE TABLE training_progress (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    resource_name TEXT,
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CARE HOME EMAILS — cache of email addresses found via web search
-- or seeded from Tony's existing contacts. Avoids paying per lookup repeatedly.
CREATE TABLE care_home_emails (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    care_home_name TEXT NOT NULL,
    postcode TEXT,
    email TEXT NOT NULL,
    source TEXT,                       -- 'web_search' | 'tony_seed' | 'user_confirmed'
    verified BOOLEAN DEFAULT FALSE,    -- Tony has confirmed it works
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_care_home_emails_name ON care_home_emails (LOWER(care_home_name));
CREATE INDEX idx_care_home_emails_postcode ON care_home_emails (postcode);

-- 6. EMAIL RESPONSES — yes/no clicks on post-match emails
CREATE TABLE email_responses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    stage INTEGER NOT NULL,
    answer TEXT NOT NULL,                -- 'yes' | 'no'
    responded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_responses_user ON email_responses (user_id, stage);

-- 7. CARE HOME SEARCHES — cache results for the same postcode so we don't
-- re-pay for OpenAI web-search calls. 7-day TTL enforced at application layer.
CREATE TABLE care_home_searches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    postcode TEXT NOT NULL,              -- normalized: uppercase, no spaces
    radius_miles INTEGER NOT NULL,
    max_results INTEGER NOT NULL,
    source TEXT,                         -- 'cqc' | 'web_search'
    payload JSONB NOT NULL,
    cached_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_care_home_searches_lookup
    ON care_home_searches (postcode, radius_miles, max_results, cached_at DESC);


-- ============================================================
-- DASHBOARD VIEWS
-- ============================================================

CREATE VIEW dashboard_overview AS
SELECT
    status,
    COUNT(*) AS count,
    MIN(created_at) AS earliest_signup,
    MAX(created_at) AS latest_signup
FROM users
GROUP BY status
ORDER BY count DESC;

CREATE VIEW dashboard_waiting AS
SELECT
    u.id              AS user_id,
    u.first_name || ' ' || COALESCE(u.surname, '') AS full_name,
    u.email,
    u.age,
    u.postcode,
    c.care_home_name,
    c.care_home_phone,
    c.method,
    c.contacted_at,
    c.nudge_stage,
    EXTRACT(DAY FROM NOW() - c.contacted_at)::int AS days_waiting
FROM contacts c
JOIN users u ON c.user_id = u.id
WHERE c.reply_received = FALSE
ORDER BY c.contacted_at ASC;

CREATE VIEW dashboard_stuck AS
SELECT
    u.id              AS user_id,
    u.first_name || ' ' || COALESCE(u.surname, '') AS full_name,
    u.email,
    u.age,
    u.postcode,
    u.created_at      AS signed_up,
    EXTRACT(DAY FROM NOW() - u.created_at)::int AS days_since_signup
FROM users u
LEFT JOIN contacts c ON u.id = c.user_id
WHERE c.id IS NULL
  AND u.created_at < NOW() - INTERVAL '7 days'
ORDER BY u.created_at ASC;

CREATE VIEW dashboard_matched AS
SELECT
    u.id              AS user_id,
    u.first_name || ' ' || COALESCE(u.surname, '') AS full_name,
    u.email,
    u.age,
    c.care_home_name,
    c.contacted_at,
    c.outcome
FROM contacts c
JOIN users u ON c.user_id = u.id
WHERE c.outcome = 'accepted'
ORDER BY c.contacted_at DESC;

CREATE VIEW dashboard_monthly_signups AS
SELECT
    DATE_TRUNC('month', created_at) AS month,
    COUNT(*) AS signups
FROM users
GROUP BY month
ORDER BY month DESC;

CREATE VIEW dashboard_all_users AS
SELECT
    u.id,
    u.first_name,
    u.surname,
    u.first_name || ' ' || COALESCE(u.surname, '') AS full_name,
    u.email,
    u.age,
    u.postcode,
    u.school,
    u.status,
    u.created_at,
    (SELECT COUNT(*) FROM contacts WHERE user_id = u.id) AS contact_count
FROM users u
ORDER BY u.created_at DESC;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- The backend uses the service_role key so it bypasses RLS.
-- This blocks anyone from accessing data with the anon key directly.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_home_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_home_searches ENABLE ROW LEVEL SECURITY;
