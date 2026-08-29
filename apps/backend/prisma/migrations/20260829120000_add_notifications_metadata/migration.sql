-- Dynamic tenant notifications: a service-request-status notification needs
-- to carry the exact request id so tapping it can open that ticket, not
-- guess at one parsed out of the title/message text. `metadata` follows the
-- same nullable-Json convention already used by ~14 other tables in this
-- schema (e.g. owner_assistant_confirmations.payload_json).

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
