CREATE TYPE "TenantAccessMode" AS ENUM ('SELF_SERVE', 'OWNER_MANAGED');

ALTER TABLE "tenants"
  ADD COLUMN "access_mode" "TenantAccessMode" NOT NULL DEFAULT 'SELF_SERVE',
  ADD COLUMN "display_name" TEXT;

CREATE TABLE "tenant_owner_attestations" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"     UUID NOT NULL,
  "hostel_id"     UUID NOT NULL,
  "attested_by"   UUID NOT NULL,
  "attested_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "attested_ip"   TEXT,
  "rules_version" TEXT,
  "note"          TEXT,
  CONSTRAINT "tenant_owner_attestations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_owner_attestations_tenant_id_idx"
  ON "tenant_owner_attestations"("tenant_id");
CREATE INDEX "tenant_owner_attestations_hostel_id_idx"
  ON "tenant_owner_attestations"("hostel_id");

ALTER TABLE "tenant_owner_attestations"
  ADD CONSTRAINT "tenant_owner_attestations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_owner_attestations"
  ADD CONSTRAINT "tenant_owner_attestations_hostel_id_fkey"
  FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
