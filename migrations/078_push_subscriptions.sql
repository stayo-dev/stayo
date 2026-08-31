-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 078: Web push subscriptions
--
-- One row per browser install, NOT per user: an owner with a phone and a laptop
-- has two. Sending means iterating every row for a profile.
--
-- `endpoint` is the push service's URL for that install and is globally unique,
-- so it is the natural key — re-subscribing the same browser must update rather
-- than duplicate.
--
-- Subscriptions expire and rotate silently. A 404/410 from the push service
-- means gone forever, and the row is deleted rather than retried; `failure_count`
-- tracks the softer failures.
--
-- ON DELETE CASCADE: a deleted profile must not leave push endpoints behind that
-- would keep receiving messages about an account that no longer exists.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT REFERENCES IT.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  failure_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_subscriptions_profile_id_idx
  ON push_subscriptions (profile_id);
