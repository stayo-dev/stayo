CREATE INDEX IF NOT EXISTS idx_owner_assistant_confirmations_action_created
  ON owner_assistant_confirmations (owner_id, phone_number, action_type, created_at DESC);
