-- Migration: Add OwnerOnboardingState table
-- This table persists cross-device, cross-session onboarding state for owners.
-- It survives logout, device switching, app reinstalls, and browser clears.
-- Derived activation is computed separately from real operational data.

CREATE TABLE IF NOT EXISTS owner_onboarding_states (
  owner_id                UUID        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- Current claimed step (informational — real state derived from business data)
  onboarding_step         TEXT        NOT NULL DEFAULT 'ACCOUNT_CREATED',

  -- Completion timestamp (when COMPLETED step was first reached)
  onboarding_completed_at TIMESTAMPTZ NULL,

  -- Last time the owner was seen in the onboarding flow
  onboarding_last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Steps explicitly skipped by the owner (JSON array of step names)
  skipped_steps           JSONB       NOT NULL DEFAULT '[]',

  -- Acquisition channel / source
  onboarding_source       TEXT        NULL,

  -- Version of the onboarding flow (for A/B testing and rollout tracking)
  onboarding_version      TEXT        NOT NULL DEFAULT 'v2',

  -- Derived activation score cached here for performance (0-100)
  activation_score        INT         NOT NULL DEFAULT 0,

  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for admin analytics queries
CREATE INDEX IF NOT EXISTS idx_onboarding_step ON owner_onboarding_states(onboarding_step);
CREATE INDEX IF NOT EXISTS idx_onboarding_completed_at ON owner_onboarding_states(onboarding_completed_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_last_seen_at ON owner_onboarding_states(onboarding_last_seen_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_score ON owner_onboarding_states(activation_score);
