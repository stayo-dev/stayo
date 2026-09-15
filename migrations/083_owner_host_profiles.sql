-- 083_owner_host_profiles.sql
--
-- Meet your host (ADR-200). The owner as residents meet them on a public
-- listing: their own words, the languages they speak, the year they started.
-- Photo stays on `profile_identity.photo_url`; stats are counted, not stored.
--
-- A TABLE OF ITS OWN, deliberately not columns on `profile_identity`. That
-- table is read without an explicit `select` in several places; declaring a
-- new column on it ahead of this migration would make every one of those
-- reads demand a column that does not exist — the 2026-08-22 `navigation`
-- outage. A new model only affects its own queries, and the public listing
-- reads this one tolerantly (a missing table reads as "no bio").
--
-- RLS ON, NO POLICIES: backend-only, like ADR-189's billing tables. The
-- backend connection bypasses RLS; anon/authenticated see nothing via
-- PostgREST.
--
-- Apply via the Supabase SQL editor or psql. Idempotent. Never
-- `prisma migrate deploy` (see prisma-field-addition notes in docs/obsidian).

CREATE TABLE IF NOT EXISTS owner_host_profiles (
  profile_id    uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  bio           text CHECK (bio IS NULL OR char_length(bio) <= 500),
  languages     text[] NOT NULL DEFAULT '{}',
  hosting_since smallint CHECK (hosting_since IS NULL OR hosting_since BETWEEN 1950 AND 2100),
  bio_hidden    boolean NOT NULL DEFAULT false,
  photo_hidden  boolean NOT NULL DEFAULT false,
  updated_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);

ALTER TABLE owner_host_profiles ENABLE ROW LEVEL SECURITY;
