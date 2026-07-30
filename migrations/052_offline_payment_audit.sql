-- Migration 052: Offline payment audit trail + whatsapp_logs table

-- Audit fields on payments (manual/cash recordings)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS offline_recorded_by  UUID,
  ADD COLUMN IF NOT EXISTS offline_recorded_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offline_recorded_ip  TEXT,
  ADD COLUMN IF NOT EXISTS offline_note         TEXT;

-- WhatsApp notification log (added to schema by user)
CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT        NOT NULL,
  template      TEXT        NOT NULL,
  obligation_id UUID,
  status        TEXT        NOT NULL,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_obligation_template_created
  ON whatsapp_logs (obligation_id, template, created_at);
