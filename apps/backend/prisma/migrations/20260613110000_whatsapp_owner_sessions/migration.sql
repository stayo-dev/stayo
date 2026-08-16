CREATE TABLE IF NOT EXISTS "whatsapp_owner_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL,
  "phone_number" text NOT NULL,
  "connected_hostel_id" uuid NULL,
  "current_screen" text NULL,
  "pending_action" jsonb NULL,
  "pending_action_expires_at" timestamptz NULL,
  "last_interaction_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NULL
);

-- `CREATE TABLE IF NOT EXISTS` above no-ops on a database where this table
-- was already hand-created (via Supabase SQL editor, outside this tracked
-- migration history) at its *later* final shape — which never had this
-- column, since the very next migration
-- (20260613123000_remove_whatsapp_session_scope) drops it 13 minutes after
-- this one adds it. Confirmed live 2026-08-15 while resolving a stuck
-- `migrate deploy`: the column was genuinely missing, not renamed. This
-- keeps the add-then-drop history intact rather than deleting the now-dead
-- index below, so a fresh install and this database converge on the same
-- end state via the same two migrations.
ALTER TABLE "whatsapp_owner_sessions"
  ADD COLUMN IF NOT EXISTS "connected_hostel_id" uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_owner_sessions_owner_phone_key"
  ON "whatsapp_owner_sessions" ("owner_id", "phone_number");

CREATE INDEX IF NOT EXISTS "whatsapp_owner_sessions_owner_hostel_idx"
  ON "whatsapp_owner_sessions" ("owner_id", "connected_hostel_id");

CREATE INDEX IF NOT EXISTS "whatsapp_owner_sessions_last_interaction_idx"
  ON "whatsapp_owner_sessions" ("last_interaction_at");
