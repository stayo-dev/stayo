-- Migration 020: Add provider-backed online payment support

CREATE TABLE IF NOT EXISTS payment_gateway_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('PHONEPE', 'RAZORPAY')),
    encrypted_config TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_gateway_configs_owner_provider
    ON payment_gateway_configs(owner_id, provider);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_gateway_configs_owner_default
    ON payment_gateway_configs(owner_id)
    WHERE is_default = TRUE AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    obligation_id UUID NOT NULL REFERENCES rent_obligations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('PHONEPE', 'RAZORPAY')),
    merchant_txn_id TEXT NOT NULL UNIQUE,
    gateway_txn_id TEXT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED')),
    upi_intent_url TEXT,
    qr_payload TEXT,
    expires_at TIMESTAMPTZ,
    raw_create_response JSONB,
    raw_webhook_payload JSONB,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_status_created_at
    ON payment_attempts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_obligation_id
    ON payment_attempts(obligation_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_owner_id
    ON payment_attempts(owner_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_student_id
    ON payment_attempts(student_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'payment_attempt_id'
    ) THEN
        ALTER TABLE payments ADD COLUMN payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_attempt_id_unique
    ON payments(payment_attempt_id)
    WHERE payment_attempt_id IS NOT NULL;

ALTER TABLE payment_gateway_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage payment gateway configs" ON payment_gateway_configs;
CREATE POLICY "Admin can manage payment gateway configs" ON payment_gateway_configs
    FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "Admin can manage payment attempts" ON payment_attempts;
CREATE POLICY "Admin can manage payment attempts" ON payment_attempts
    FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "Student can view own payment attempts" ON payment_attempts;
CREATE POLICY "Student can view own payment attempts" ON payment_attempts
    FOR SELECT USING (auth.uid() = (SELECT profile_id FROM students WHERE students.id = payment_attempts.student_id));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'set_updated_at_payment_gateway_configs'
        ) THEN
            CREATE TRIGGER set_updated_at_payment_gateway_configs
            BEFORE UPDATE ON payment_gateway_configs
            FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'set_updated_at_payment_attempts'
        ) THEN
            CREATE TRIGGER set_updated_at_payment_attempts
            BEFORE UPDATE ON payment_attempts
            FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
        END IF;
    END IF;
END $$;
