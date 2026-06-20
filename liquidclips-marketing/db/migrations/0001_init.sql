-- 0001_init · Founding Clippers waitlist · single shared database for
-- waitlist + referrals + founding-members flow.
--
-- One canonical table (`waitlist`) carries every signup with the columns
-- the launch spec listed: email, role, source, referral_code (this person's
-- shareable code), referred_by (the code that brought them), created_at,
-- waitlist_status. A separate event-log table (`referral_clicks`) records
-- every ?ref=CODE landing for analytics + audit — totals are still
-- recoverable with a GROUP BY on referred_by.
--
-- CITEXT keeps email + code lookups case-insensitive so "Hello@x.com" or
-- "FoundingABC1" don't slip past their canonical row.

CREATE EXTENSION IF NOT EXISTS citext;

-- ── waitlist ─────────────────────────────────────────────────────────────
-- One row per Founding Clippers signup. Carries the referrer link
-- (referred_by) AND the signup's own shareable code (referral_code).
CREATE TABLE IF NOT EXISTS waitlist (
  id                   BIGSERIAL PRIMARY KEY,
  email                CITEXT NOT NULL UNIQUE,
  role                 TEXT
                       CHECK (role IS NULL OR role IN ('creator', 'clipper', 'agency')),
  source               TEXT NOT NULL
                       CHECK (source IN ('product_hunt', 'website', 'referral', 'direct')),
  source_page          TEXT,                              -- e.g. '/launch'
  product_hunt_username TEXT,                              -- optional · for PH upvote correlation
  referral_code        CITEXT NOT NULL UNIQUE,            -- this user's code
  referred_by          CITEXT REFERENCES waitlist(referral_code) ON DELETE SET NULL,
  waitlist_status      TEXT NOT NULL DEFAULT 'waiting'
                       CHECK (waitlist_status IN (
                         'waiting',          -- signed up, awaiting access
                         'early_access',     -- got the desktop build
                         'founding_member',  -- completed founding signup (paid)
                         'churned'           -- left after access
                       )),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_role_idx           ON waitlist (role);
CREATE INDEX IF NOT EXISTS waitlist_source_idx         ON waitlist (source);
CREATE INDEX IF NOT EXISTS waitlist_status_idx         ON waitlist (waitlist_status);
CREATE INDEX IF NOT EXISTS waitlist_referred_by_idx    ON waitlist (referred_by);
CREATE INDEX IF NOT EXISTS waitlist_created_at_idx     ON waitlist (created_at DESC);

-- ── referral_clicks (per-landing event log) ──────────────────────────────
-- Captures every ?ref=CODE hit so per-referrer click counts are auditable.
-- Aggregate at query time:
--   SELECT referral_code, COUNT(*) FROM referral_clicks GROUP BY referral_code;
CREATE TABLE IF NOT EXISTS referral_clicks (
  id              BIGSERIAL PRIMARY KEY,
  referral_code   CITEXT NOT NULL,
  ip_hash         TEXT,
  ua_fingerprint  TEXT,
  landed_path     TEXT,
  country         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_clicks_code_idx
  ON referral_clicks (referral_code);
CREATE INDEX IF NOT EXISTS referral_clicks_created_at_idx
  ON referral_clicks (created_at DESC);
