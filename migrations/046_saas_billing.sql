-- Migration 046: SaaS Billing — Plans, Subscriptions, Invoices
-- Idempotent: safe to run multiple times.

-- ─── 1. Plans table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plans (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT        NOT NULL UNIQUE,
    name          TEXT        NOT NULL,
    price_paise   INTEGER     NOT NULL DEFAULT 0,
    tenant_limit  INTEGER,                        -- NULL = unlimited
    hostel_limit  INTEGER,                        -- NULL = unlimited
    features      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    display_order INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Seed plans (idempotent) ────────────────────────────────

INSERT INTO plans (code, name, price_paise, tenant_limit, hostel_limit, features, is_active, display_order)
VALUES
  ('STARTER',
   'Starter',
   49900,
   25,
   1,
   '["1 Hostel", "Up to 25 tenants", "Payments & receipts", "Basic reporting", "Email support"]'::jsonb,
   TRUE,
   1),
  ('PRO',
   'Pro',
   149900,
   100,
   3,
   '["Up to 3 Hostels", "Up to 100 tenants", "Advanced analytics", "Rent reminders", "Document management", "Priority support"]'::jsonb,
   TRUE,
   2),
  ('BUSINESS',
   'Business',
   399900,
   NULL,
   NULL,
   '["Unlimited Hostels", "Unlimited tenants", "Full analytics", "All automation", "API access (coming soon)", "Dedicated support"]'::jsonb,
   TRUE,
   3)
ON CONFLICT (code) DO UPDATE
  SET name          = EXCLUDED.name,
      price_paise   = EXCLUDED.price_paise,
      tenant_limit  = EXCLUDED.tenant_limit,
      hostel_limit  = EXCLUDED.hostel_limit,
      features      = EXCLUDED.features,
      display_order = EXCLUDED.display_order;

-- ─── 3. Owner subscriptions table ──────────────────────────────

CREATE TABLE IF NOT EXISTS owner_subscriptions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID        NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id     UUID        NOT NULL REFERENCES plans(id),
    status      TEXT        NOT NULL DEFAULT 'FREE'
                            CHECK (status IN ('FREE', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED')),
    start_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
    end_date    DATE,
    auto_renew  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_owner_subscriptions_owner  ON owner_subscriptions(owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_subscriptions_status ON owner_subscriptions(status);

-- ─── 4. Auto-assign STARTER to every existing owner ────────────
-- Owners who existed before this migration get a free Starter subscription.

INSERT INTO owner_subscriptions (owner_id, plan_id, status, start_date)
SELECT
    p.id AS owner_id,
    (SELECT id FROM plans WHERE code = 'STARTER') AS plan_id,
    'FREE'         AS status,
    CURRENT_DATE   AS start_date
FROM profiles p
WHERE p.role = 'OWNER'
  AND NOT EXISTS (
    SELECT 1 FROM owner_subscriptions os WHERE os.owner_id = p.id
  );

-- ─── 5. Owner invoices table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS owner_invoices (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    subscription_id UUID        REFERENCES owner_subscriptions(id) ON DELETE SET NULL,
    plan_id         UUID        REFERENCES plans(id) ON DELETE SET NULL,
    invoice_number  TEXT        UNIQUE,
    amount_paise    INTEGER     NOT NULL DEFAULT 0,
    status          TEXT        NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'VOID')),
    billing_month   DATE,
    due_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_invoices_owner   ON owner_invoices(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owner_invoices_status  ON owner_invoices(status);
