-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 081: `users` — the auth-agnostic identity anchor (ADR-176)
--
-- Phase 1 of the Supabase Auth → Clerk migration. Clerk becomes the single
-- source of truth for *identity and sessions*; this table is how that identity
-- lands in our database without the database depending on the auth vendor.
--
-- The design constraint that shapes every column here: **nothing in this table
-- is Supabase-specific, and nothing is Clerk-specific except `clerk_user_id`.**
-- Swapping auth vendors again should mean adding one column and backfilling it,
-- not reshaping the schema. That is why business data is deliberately absent —
-- `role` (OWNER/TENANT/ADMIN), hostels, tenancies and money all stay on
-- `profiles` and its relations. This table answers "who is this login?", never
-- "what may they do?".
--
-- Relationship to `profiles`:
--   `profiles` is unchanged and remains the business identity. A `users` row
--   points at it via `profile_id`, matched by email when the webhook first sees
--   the account. `profile_id` is NULLABLE on purpose — Clerk can legitimately
--   know about a person before we have provisioned them any business role, and
--   a webhook must never invent a profile (the same no-auto-provisioning rule
--   ADR-031 established and ADR-073 upheld).
--
--   Note this deliberately does NOT add a column to `profiles`. On 2026-08-22 a
--   field declared in schema.prisma whose column did not yet exist broke every
--   query on that model in production, because Prisma names all scalar columns
--   in its SELECT. A new table carrying the foreign key has no such blast
--   radius: no existing query reads it.
--
-- Deletion is soft, always. `user.deleted` from Clerk sets `is_active = false`
-- and stamps `deactivated_at`; it never deletes the row and never touches the
-- linked profile. Residency history, obligations, payments and receipts must
-- survive the disappearance of a login — an ex-resident's settled ledger is
-- still evidence, and Clerk is not the system of record for it.
--
-- `clerk_updated_at` exists because Svix delivery is at-least-once and
-- unordered: it stores the `updated_at` Clerk stamped on the user object so a
-- retried or overtaken event cannot overwrite newer data with older data.
--
-- ── Deploy order (matters) ──────────────────────────────────────────────────
-- Apply this migration BEFORE deploying code that reads `users`. The Prisma
-- model landing in a deploy whose table does not exist is the failure mode
-- described above, in the other direction.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The stable external identity. Clerk's user id ("user_2abc..."), never reused,
  -- never re-minted for the same person. This is the join key for every future
  -- auth-vendor question; it is the ONLY vendor-shaped column in the table.
  clerk_user_id     TEXT        NOT NULL UNIQUE,

  -- Mirrored profile fields. This is the complete allow-list that `user.updated`
  -- is permitted to write — see ALLOWED_PROFILE_FIELDS in
  -- src/services/auth/clerk-user-sync-service.ts, which is asserted against this
  -- list by tests/clerk-user-sync.test.ts.
  email             TEXT,
  first_name        TEXT,
  last_name         TEXT,
  image_url         TEXT,

  -- Soft-deactivation. `user.deleted` sets these; no code path deletes the row.
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  deactivated_at    TIMESTAMPTZ,

  -- Business identity, when one exists. Nullable by design (see header).
  -- ON DELETE SET NULL: removing a profile must not cascade away the login record.
  profile_id        UUID UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,

  -- Clerk's own `updated_at` for the user object, used to reject stale/replayed
  -- webhook deliveries. Nullable: `user.created` may arrive without it.
  clerk_updated_at  TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email is how a Clerk account is matched to an existing `profiles` row on first
-- sight. Not UNIQUE: Clerk allows an account with no email, and uniqueness of a
-- *business* identity is already enforced on `profiles.email`.
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- The operational query behind "which logins are live".
CREATE INDEX IF NOT EXISTS users_is_active_idx ON users (is_active);
