-- This database already has this exact table (hand-created via Supabase SQL
-- editor, outside this tracked migration history) — confirmed live
-- 2026-08-15 while resolving a stuck `migrate deploy`: same columns,
-- indexes, and FK, verified directly via information_schema before making
-- this idempotent rather than assuming.

-- CreateTable
CREATE TABLE IF NOT EXISTS "tenant_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenant_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tenant_notes_tenant_id_created_at_idx" ON "tenant_notes"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tenant_notes_owner_id_idx" ON "tenant_notes"("owner_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "tenant_notes" ADD CONSTRAINT "tenant_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
