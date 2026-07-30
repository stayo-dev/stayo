-- Optional analytics field for student-selected UPI app before Razorpay checkout
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS preferred_app TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_preferred_app ON payments(preferred_app);
