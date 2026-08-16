-- Tenant/user → Stayo Admin support tickets (ADR-079). Deliberately separate
-- from tenant_service_requests/complaints (tenant → owner/hostel): no
-- owner_id or hostel_id, no relation to tenants. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "platform_support_tickets" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id"  UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "category"    TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'OPEN',
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "resolved_at" TIMESTAMPTZ(6),
  "resolved_by" UUID,
  "admin_note"  TEXT
);

CREATE INDEX IF NOT EXISTS "platform_support_tickets_profile_id_idx" ON "platform_support_tickets" ("profile_id");
CREATE INDEX IF NOT EXISTS "platform_support_tickets_status_idx" ON "platform_support_tickets" ("status");
