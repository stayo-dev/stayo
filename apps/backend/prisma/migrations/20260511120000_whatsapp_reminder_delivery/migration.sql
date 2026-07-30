ALTER TABLE whatsapp_logs
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_id UUID,
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS hostel_id UUID,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_error_code TEXT,
  ADD COLUMN IF NOT EXISTS provider_error_message TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_response JSONB;

UPDATE whatsapp_logs
SET template_name = COALESCE(template_name, template),
    delivery_status = CASE
      WHEN delivery_status IS NULL OR delivery_status = 'UNKNOWN' THEN status
      ELSE delivery_status
    END;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_logs_idempotency_key_key
  ON whatsapp_logs (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_owner_created
  ON whatsapp_logs (owner_id, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_tenant_created
  ON whatsapp_logs (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_hostel_created
  ON whatsapp_logs (hostel_id, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_delivery_status_created
  ON whatsapp_logs (delivery_status, created_at);
