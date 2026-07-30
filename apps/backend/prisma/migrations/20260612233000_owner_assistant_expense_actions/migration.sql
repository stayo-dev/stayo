ALTER TABLE owner_assistant_confirmations
  DROP CONSTRAINT IF EXISTS owner_assistant_confirmations_action_check;

ALTER TABLE owner_assistant_confirmations
  ADD CONSTRAINT owner_assistant_confirmations_action_check
  CHECK (action_type IN ('SEND_REMINDERS', 'CREATE_EXPENSE', 'UNDO_EXPENSE'));
