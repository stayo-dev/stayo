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

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_owner_sessions_owner_phone_key"
  ON "whatsapp_owner_sessions" ("owner_id", "phone_number");

CREATE INDEX IF NOT EXISTS "whatsapp_owner_sessions_owner_hostel_idx"
  ON "whatsapp_owner_sessions" ("owner_id", "connected_hostel_id");

CREATE INDEX IF NOT EXISTS "whatsapp_owner_sessions_last_interaction_idx"
  ON "whatsapp_owner_sessions" ("last_interaction_at");
