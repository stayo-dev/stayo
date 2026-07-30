CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'META',
  event_hash TEXT NOT NULL UNIQUE,
  event_type TEXT,
  provider_message_id TEXT,
  raw_payload JSONB NOT NULL,
  headers_redacted JSONB,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  signature_algorithm TEXT,
  signature_failure_reason TEXT,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
  processing_result JSONB,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_provider_received
  ON whatsapp_webhook_events (provider, received_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_provider_message
  ON whatsapp_webhook_events (provider_message_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_processing_status
  ON whatsapp_webhook_events (processing_status);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_provider_message_id
  ON whatsapp_logs (provider_message_id);
