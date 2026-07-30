-- Billing & Plans foundation tables (MVP + future Razorpay)

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'INR',
    room_limit INTEGER,
    hostel_limit INTEGER,
    storage_limit_mb INTEGER NOT NULL DEFAULT 500,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS owner_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    status TEXT NOT NULL DEFAULT 'FREE',
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    next_billing_date DATE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,

    razorpay_customer_id TEXT,
    razorpay_subscription_id TEXT,

    payment_method_type TEXT,
    payment_method_last4 TEXT,
    payment_upi_id TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,

    CONSTRAINT owner_subscriptions_status_check CHECK (status IN ('FREE', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED'))
);

CREATE TABLE IF NOT EXISTS owner_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES owner_subscriptions(id) ON DELETE SET NULL,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    invoice_number TEXT UNIQUE,
    amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    billing_month DATE,
    pdf_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT owner_invoices_status_check CHECK (status IN ('DRAFT', 'PAID', 'FAILED', 'VOID'))
);

CREATE INDEX IF NOT EXISTS idx_plans_active_order ON plans(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_owner_subscriptions_owner ON owner_subscriptions(owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_subscriptions_status ON owner_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_owner_invoices_owner_created ON owner_invoices(owner_id, created_at DESC);

-- Seed plans (idempotent)
INSERT INTO plans (code, name, price, currency, room_limit, hostel_limit, storage_limit_mb, features, is_active, display_order)
VALUES
    ('STARTER', 'Starter', 0, 'INR', 50, 1, 500, '["1 Hostel", "50 Rooms", "Basic Support"]'::jsonb, TRUE, 1),
    ('PRO', 'Pro', 999, 'INR', 200, 3, 2000, '["3 Hostels", "200 Rooms", "Priority Support"]'::jsonb, TRUE, 2),
    ('BUSINESS', 'Business', 2499, 'INR', NULL, NULL, 5000, '["Unlimited Hostels", "Unlimited Rooms", "Priority Support"]'::jsonb, TRUE, 3)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    room_limit = EXCLUDED.room_limit,
    hostel_limit = EXCLUDED.hostel_limit,
    storage_limit_mb = EXCLUDED.storage_limit_mb,
    features = EXCLUDED.features,
    is_active = EXCLUDED.is_active,
    display_order = EXCLUDED.display_order;
