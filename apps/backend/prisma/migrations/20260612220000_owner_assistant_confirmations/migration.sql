CREATE TABLE IF NOT EXISTS owner_assistant_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT owner_assistant_confirmations_action_check
    CHECK (action_type IN ('SEND_REMINDERS')),
  CONSTRAINT owner_assistant_confirmations_status_check
    CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_owner_assistant_confirmations_pending_lookup
  ON owner_assistant_confirmations (owner_id, phone_number, action_type, expires_at DESC)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_owner_assistant_confirmations_status_expires
  ON owner_assistant_confirmations (status, expires_at);
