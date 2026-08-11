-- Owner-controlled ordering for rooms within a floor (Rooms tab drag reorder).
--
-- Same pattern as `hostels.display_order` (see 20260804120000_hostel_display_order,
-- ADR-042): NULLABLE ON PURPOSE, not backfilled. NULL means "never reordered";
-- the read path (PropertyService.getFloorsWithRooms) sorts NULLs last and then
-- by room_no, which is exactly the order rooms had before this column existed.
--
-- Writes are owner-scoped and go only through PATCH /api/rooms/reorder, which
-- rewrites every room's position within one floor inside a single transaction.
--
-- Idempotent — safe to re-run.

ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER;

CREATE INDEX IF NOT EXISTS "rooms_floor_id_sort_order_idx"
  ON "rooms" ("floor_id", "sort_order");
