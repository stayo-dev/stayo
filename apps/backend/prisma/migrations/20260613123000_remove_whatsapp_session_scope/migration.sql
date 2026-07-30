DROP INDEX IF EXISTS "whatsapp_owner_sessions_owner_hostel_idx";

ALTER TABLE "whatsapp_owner_sessions"
  DROP COLUMN IF EXISTS "connected_hostel_id";
