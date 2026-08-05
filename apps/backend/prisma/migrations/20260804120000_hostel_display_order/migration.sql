-- Owner-controlled ordering for the Home "Property" list.
--
-- Until now the Property cards carried a `⠿` drag handle that did nothing:
-- react-dnd was in package.json but imported nowhere, no DndProvider was ever
-- mounted, and DragHandle was a decorative aria-hidden <span>. There was also
-- no column to store an order in, so nothing could have been persisted.
--
-- NULLABLE ON PURPOSE, and deliberately not backfilled. NULL means "the owner
-- has never reordered this hostel", and the read path sorts NULLs last and
-- then by name — which is exactly the order the list had before this change.
-- So existing owners see no reshuffle until they actually drag something, and
-- a newly created hostel appends to the end rather than jumping to the top.
--
-- Writes are owner-scoped and go only through
-- PATCH /api/owner/hostels/reorder, which rewrites every position for that
-- owner inside one transaction. See ADR-042.
--
-- Idempotent — safe to re-run.

ALTER TABLE "hostels" ADD COLUMN IF NOT EXISTS "display_order" INTEGER;

-- Supports the owner-scoped ordered read in PortfolioService.getPortfolioSummary.
CREATE INDEX IF NOT EXISTS "hostels_owner_id_display_order_idx"
  ON "hostels" ("owner_id", "display_order");
