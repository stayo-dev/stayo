-- Atomic hostel provisioning (audit Task 1).
--
-- The onboarding wizard collected hostel type, "food available?" and the
-- publish-vs-draft choice and then discarded all three, because
-- POST /api/owner/hostels had nowhere to put them. These three columns give
-- POST /api/owner/hostels/provision somewhere to put them.
--
-- `publish_requested` is deliberately NOT `listing_status`. `listing_status`
-- is admin-controlled and is set to LIVE only alongside
-- `verification_status = VERIFIED` by the Platform Admin console
-- (approve-listing / suspend-listing / reactivate). If onboarding wrote it,
-- any owner could self-approve their public listing past platform
-- verification. `publish_requested` records the owner's intent instead and
-- leaves the gate where it is. See ADR-040.
--
-- Idempotent — safe to re-run.

ALTER TABLE "hostels" ADD COLUMN IF NOT EXISTS "hostel_type" TEXT;
ALTER TABLE "hostels" ADD COLUMN IF NOT EXISTS "food_included" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "hostels" ADD COLUMN IF NOT EXISTS "publish_requested" BOOLEAN NOT NULL DEFAULT FALSE;
