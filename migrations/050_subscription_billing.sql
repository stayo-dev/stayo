-- Migration: Add subscription, plans, message packs and autopay attempts
-- Creates central billing / subscription tables and seed plans

BEGIN;

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_inr INTEGER NOT NULL DEFAULT 0,
  tenant_limit INTEGER NOT NULL DEFAULT 0,
  hostel_limit INTEGER NOT NULL DEFAULT 0,
  automation BOOLEAN NOT NULL DEFAULT FALSE,
  messaging BOOLEAN NOT NULL DEFAULT FALSE,
  multi_hostel BOOLEAN NOT NULL DEFAULT FALSE,
  analytics BOOLEAN NOT NULL DEFAULT FALSE,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'TRIAL', -- TRIAL, ACTIVE, GRACE, EXPIRED, LIMITED
  trial_ends_at TIMESTAMP WITH TIME ZONE,
  start_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
  next_billing_at TIMESTAMP WITH TIME ZONE,
  autopay_enabled BOOLEAN NOT NULL DEFAULT true,
  grace_started_at TIMESTAMP WITH TIME ZONE,
  grace_ends_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Message packs table (credits)
CREATE TABLE IF NOT EXISTS message_packs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  purchased_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  messages_total INTEGER NOT NULL,
  messages_remaining INTEGER NOT NULL,
  price_inr INTEGER NOT NULL,
  notes TEXT
);

-- Message audit log
CREATE TABLE IF NOT EXISTS message_logs (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  channel TEXT,
  template TEXT,
  recipient TEXT,
  success BOOLEAN,
  deduction INTEGER DEFAULT 0,
  provider_response TEXT
);

-- Autopay attempts for retry history
CREATE TABLE IF NOT EXISTS autopay_attempts (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  attempt_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  result TEXT NOT NULL,
  provider_response TEXT
);

-- Seed default plans (id chosen as canonical keys)
INSERT INTO plans (id, name, price_inr, tenant_limit, hostel_limit, automation, messaging, multi_hostel, analytics, is_custom)
VALUES
('FREE', 'FREE', 0, 20, 1, false, false, false, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plans (id, name, price_inr, tenant_limit, hostel_limit, automation, messaging, multi_hostel, analytics, is_custom)
VALUES
('STARTER', 'STARTER', 799, 60, 1, true, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plans (id, name, price_inr, tenant_limit, hostel_limit, automation, messaging, multi_hostel, analytics, is_custom)
VALUES
('GROWTH', 'GROWTH', 1499, 150, 2, true, true, true, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plans (id, name, price_inr, tenant_limit, hostel_limit, automation, messaging, multi_hostel, analytics, is_custom)
VALUES
('BUSINESS', 'BUSINESS', 2499, 400, 4, true, true, true, true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plans (id, name, price_inr, tenant_limit, hostel_limit, automation, messaging, multi_hostel, analytics, is_custom)
VALUES
('SCALE', 'SCALE', 0, 0, 0, true, true, true, true, true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
