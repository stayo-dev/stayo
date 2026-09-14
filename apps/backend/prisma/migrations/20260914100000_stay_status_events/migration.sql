-- Stay Status (ADR-193): the event store and its one projection.
--
-- `stay_events` is the permanent truth — every stay update is appended here
-- and never edited. `stay_leaves` is a projection of it (who is on leave now),
-- rebuildable at any time by replaying events through the one reducer in
-- `src/services/stay/stay-events.ts`.
--
-- NEW tables only — no existing table or column changes, so no read of any
-- other model is affected by deploy/migrate order (see the 2026-08-22 outage).
-- The Stay routes read these tables: APPLY THIS BEFORE DEPLOYING that code.
--
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS "stay_events" (
  "id"                   UUID           NOT NULL DEFAULT gen_random_uuid(),
  -- Total order of the stream. Replay folds in `seq` order, never by time.
  "seq"                  BIGSERIAL      NOT NULL,
  "tenant_id"            UUID           NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "hostel_id"            UUID           NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  -- The resident's room at the time, so housekeeping and trends survive transfers.
  "room_id"              UUID           REFERENCES "rooms"("id") ON DELETE SET NULL,
  "type"                 TEXT           NOT NULL,
  "effective_date"       DATE           NOT NULL,
  "occurred_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "leave_type"           TEXT,
  "expected_return_date" DATE,
  "source"               TEXT           NOT NULL,
  "actor_profile_id"     UUID,
  "actor_role"           TEXT           NOT NULL,
  "idempotency_key"      TEXT           NOT NULL,
  "schema_version"       INTEGER        NOT NULL DEFAULT 1,
  "payload"              JSONB          NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "stay_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stay_events_seq_key" ON "stay_events" ("seq");
CREATE UNIQUE INDEX IF NOT EXISTS "stay_events_idempotency_key_key" ON "stay_events" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "stay_events_hostel_occurred_idx" ON "stay_events" ("hostel_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "stay_events_tenant_seq_idx" ON "stay_events" ("tenant_id", "seq");
CREATE INDEX IF NOT EXISTS "stay_events_hostel_date_type_idx" ON "stay_events" ("hostel_id", "effective_date", "type");

CREATE TABLE IF NOT EXISTS "stay_leaves" (
  -- = the id of the LEAVE_STARTED event that opened it.
  "id"                   UUID           NOT NULL,
  "tenant_id"            UUID           NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "hostel_id"            UUID           NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  "leave_type"           TEXT           NOT NULL,
  "start_date"           DATE           NOT NULL,
  "expected_return_date" DATE           NOT NULL,
  "status"               TEXT           NOT NULL DEFAULT 'ACTIVE',
  "returned_at"          TIMESTAMPTZ(6),
  "last_event_id"        UUID           NOT NULL,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "stay_leaves_pkey" PRIMARY KEY ("id")
);

-- One active leave per tenant: the concurrency guard behind a double tap.
CREATE UNIQUE INDEX IF NOT EXISTS "stay_leaves_one_active_per_tenant"
  ON "stay_leaves" ("tenant_id") WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "stay_leaves_hostel_status_return_idx"
  ON "stay_leaves" ("hostel_id", "status", "expected_return_date");

-- Append-only, enforced by the database. UPDATE is refused; DELETE is left to
-- the tenant/hostel ON DELETE CASCADE, so erasing a tenancy still works.
CREATE OR REPLACE FUNCTION "stay_events_refuse_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stay_events is append-only (ADR-193)';
END;
$$;
DROP TRIGGER IF EXISTS "stay_events_no_update" ON "stay_events";
CREATE TRIGGER "stay_events_no_update" BEFORE UPDATE ON "stay_events"
  FOR EACH ROW EXECUTE FUNCTION "stay_events_refuse_update"();

-- Backend-only tables: RLS on with no policies, so PostgREST's anon and
-- authenticated roles see nothing. The backend's connection bypasses RLS.
ALTER TABLE "stay_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stay_leaves" ENABLE ROW LEVEL SECURITY;
