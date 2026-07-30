-- Financial System: maintenance_type + billing_start_date
-- Idempotent: safe to re-run via Supabase SQL editor

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS maintenance_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_start_date DATE;
