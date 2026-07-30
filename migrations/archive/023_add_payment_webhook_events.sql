-- Migration 023: Add payment_webhook_events table for Razorpay webhook idempotency
-- This table stores processed webhook event IDs to prevent duplicate processing.

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL,           -- Unique identifier for the webhook event
    event_type TEXT NOT NULL,         -- e.g. 'order.paid', 'payment.captured'
    razorpay_payment_id TEXT,         -- Razorpay payment ID from the event payload
    razorpay_order_id TEXT,           -- Razorpay order ID from the event payload
    obligation_id UUID,               -- Local obligation reference (if resolved)
    received_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'processed', -- 'processed' | 'skipped' | 'error'
    error_message TEXT
);

-- Unique constraint ensures each event is processed exactly once
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_event_id
    ON payment_webhook_events(event_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_webhook_events_payment_id
    ON payment_webhook_events(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
    ON payment_webhook_events(received_at DESC);

-- RLS: only service_role (backend) can access
ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON payment_webhook_events
    FOR ALL TO service_role USING (true);
