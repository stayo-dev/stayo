-- Bulk Tenant Invitation Lifecycle
-- Creates tenant-first invitations with room-level reservations.

ALTER TABLE "public"."tenants"
  ALTER COLUMN "profile_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "public"."tenant_invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
  "owner_id" UUID NOT NULL REFERENCES "public"."profiles"("id"),
  "hostel_id" UUID NOT NULL REFERENCES "public"."hostels"("id"),
  "room_id" UUID NOT NULL REFERENCES "public"."rooms"("id"),
  "batch_id" UUID REFERENCES "public"."bulk_import_batches"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "token" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "opened_at" TIMESTAMPTZ(6),
  "activation_started_at" TIMESTAMPTZ(6),
  "activated_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "idx_tenant_invitations_tenant_status"
  ON "public"."tenant_invitations" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitations_owner_hostel_status"
  ON "public"."tenant_invitations" ("owner_id", "hostel_id", "status");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitations_room_status_expiry"
  ON "public"."tenant_invitations" ("room_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitations_owner_email_status"
  ON "public"."tenant_invitations" ("owner_id", "email", "status");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitations_batch"
  ON "public"."tenant_invitations" ("batch_id");

CREATE UNIQUE INDEX IF NOT EXISTS "udx_tenant_invitations_active_owner_email"
  ON "public"."tenant_invitations" ("owner_id", lower("email"))
  WHERE "status" IN ('PENDING', 'OPENED', 'ACTIVATION_STARTED');

CREATE TABLE IF NOT EXISTS "public"."tenant_invitation_reservations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
  "invitation_id" UUID NOT NULL REFERENCES "public"."tenant_invitations"("id") ON DELETE CASCADE,
  "owner_id" UUID NOT NULL REFERENCES "public"."profiles"("id"),
  "hostel_id" UUID NOT NULL REFERENCES "public"."hostels"("id"),
  "room_id" UUID NOT NULL REFERENCES "public"."rooms"("id"),
  "batch_id" UUID REFERENCES "public"."bulk_import_batches"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "released_by" UUID REFERENCES "public"."profiles"("id"),
  "released_at" TIMESTAMPTZ(6),
  "release_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "idx_tenant_invitation_reservations_tenant_status"
  ON "public"."tenant_invitation_reservations" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitation_reservations_invitation_status"
  ON "public"."tenant_invitation_reservations" ("invitation_id", "status");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitation_reservations_room_status_expiry"
  ON "public"."tenant_invitation_reservations" ("room_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitation_reservations_owner_hostel_status"
  ON "public"."tenant_invitation_reservations" ("owner_id", "hostel_id", "status");
CREATE INDEX IF NOT EXISTS "idx_tenant_invitation_reservations_batch"
  ON "public"."tenant_invitation_reservations" ("batch_id");

CREATE UNIQUE INDEX IF NOT EXISTS "udx_tenant_invitation_reservations_active_tenant"
  ON "public"."tenant_invitation_reservations" ("tenant_id")
  WHERE "status" = 'ACTIVE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_tenant_invitation_reservation_release_metadata'
      AND conrelid = 'public.tenant_invitation_reservations'::regclass
  ) THEN
    ALTER TABLE "public"."tenant_invitation_reservations"
      ADD CONSTRAINT "chk_tenant_invitation_reservation_release_metadata"
      CHECK (
        "status" <> 'RELEASED'
        OR (
          "released_by" IS NOT NULL
          AND "released_at" IS NOT NULL
          AND "release_reason" IN ('ACTIVATED', 'EXPIRED', 'CANCELLED', 'TRANSFERRED')
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "public"."bulk_import_rows" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL REFERENCES "public"."bulk_import_batches"("id") ON DELETE CASCADE,
  "owner_id" UUID NOT NULL REFERENCES "public"."profiles"("id"),
  "hostel_id" UUID NOT NULL REFERENCES "public"."hostels"("id"),
  "row_number" INTEGER NOT NULL,
  "normalized_email" TEXT NOT NULL,
  "normalized_phone" TEXT NOT NULL,
  "normalized_room" TEXT NOT NULL,
  "mapped_data" JSONB NOT NULL,
  "validation_status" TEXT NOT NULL DEFAULT 'PENDING',
  "conflict_type" TEXT,
  "owner_decision" TEXT,
  "tenant_id" UUID REFERENCES "public"."tenants"("id") ON DELETE SET NULL,
  "invitation_id" UUID REFERENCES "public"."tenant_invitations"("id") ON DELETE SET NULL,
  "reservation_id" UUID REFERENCES "public"."tenant_invitation_reservations"("id") ON DELETE SET NULL,
  "execution_status" TEXT NOT NULL DEFAULT 'PENDING',
  "email_status" TEXT,
  "error_message" TEXT,
  "executed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "udx_bulk_import_rows_batch_identity"
  ON "public"."bulk_import_rows" ("batch_id", lower("normalized_email"), "normalized_phone");
CREATE INDEX IF NOT EXISTS "idx_bulk_import_rows_owner_hostel_execution"
  ON "public"."bulk_import_rows" ("owner_id", "hostel_id", "execution_status");
CREATE INDEX IF NOT EXISTS "idx_bulk_import_rows_batch_validation"
  ON "public"."bulk_import_rows" ("batch_id", "validation_status");
CREATE INDEX IF NOT EXISTS "idx_bulk_import_rows_tenant"
  ON "public"."bulk_import_rows" ("tenant_id");
