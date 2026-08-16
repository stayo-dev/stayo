-- Food Polls (V1) — ad-hoc, owner-created, independent of the dormant
-- food_voting_periods/food_votes system (decoupled from schedule
-- generation this same day — see ADR-056). See ADR-057.
-- Purely additive: three new tables, two new enums, no existing tables touched.
--
-- Made idempotent 2026-08-15 while resolving a stuck `migrate deploy`: this
-- database already had all three tables, both enums, and every index/FK,
-- confirmed matching exactly against information_schema before editing.

DO $$ BEGIN
  CREATE TYPE "FoodPollType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RATING', 'YES_NO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "FoodPollStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "food_polls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hostel_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "poll_type" "FoodPollType" NOT NULL,
    "meal_type" "FoodMealType" NOT NULL,
    "poll_date" DATE NOT NULL,
    "closes_at" TIMESTAMPTZ(6) NOT NULL,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "allow_multiple" BOOLEAN NOT NULL DEFAULT false,
    "status" "FoodPollStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "food_polls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "food_poll_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "poll_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "food_poll_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "food_poll_votes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "poll_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "food_poll_votes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "food_polls_hostel_id_status_idx" ON "food_polls"("hostel_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "food_poll_options_poll_id_position_key" ON "food_poll_options"("poll_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "food_poll_votes_poll_id_tenant_id_option_id_key" ON "food_poll_votes"("poll_id", "tenant_id", "option_id");
CREATE INDEX IF NOT EXISTS "food_poll_votes_poll_id_idx" ON "food_poll_votes"("poll_id");

DO $$ BEGIN
  ALTER TABLE "food_polls" ADD CONSTRAINT "food_polls_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "food_poll_options" ADD CONSTRAINT "food_poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "food_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "food_poll_votes" ADD CONSTRAINT "food_poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "food_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "food_poll_votes" ADD CONSTRAINT "food_poll_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "food_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "food_poll_votes" ADD CONSTRAINT "food_poll_votes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
