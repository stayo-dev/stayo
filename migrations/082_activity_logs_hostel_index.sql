-- 082_activity_logs_hostel_index.sql
--
-- Makes the per-hostel activity feed's audit-table read indexable.
--
-- `activity_logs` records which hostel an action belongs to in
-- `metadata.hostel_id` — there is no column for it. The owner activity feed
-- previously filtered these rows by `owner_id` alone, which meant a
-- multi-hostel owner saw one property's settings changes, rent runs, room
-- edits and expense edits on every *other* property's timeline. Scoping the
-- read to the hostel fixes that, but without this index it is a sequential
-- scan over every log row the owner has ever written.
--
-- Apply via the Supabase SQL editor or psql.
--
-- DELIBERATELY NOT ADDED TO prisma/schema.prisma. This is an expression index
-- on a JSON key; Prisma cannot express it, and the query that uses it is raw
-- SQL in `lib/services/hostel-activity-feed-service.ts`. Application code is
-- correct whether or not this file has been applied — only slower.
--
-- `system_event_logs` needs nothing here: its AGREEMENT_RENEWED rows carry no
-- hostel at all (only `tenant_id`), so the feed resolves their hostel through
-- a join on `tenants`, which is already covered by that table's primary key
-- and the existing `system_event_logs(owner_id)` index.

-- Matches the feed's predicate exactly: owner, then hostel, newest first.
-- CONCURRENTLY so this does not take a write lock on a hot audit table;
-- it must therefore be run OUTSIDE a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_owner_hostel_ts
  ON activity_logs (owner_id, (metadata->>'hostel_id'), timestamp DESC);

-- The retention cron (`/api/cron/data-retention`) deletes by owner + timestamp
-- and had no supporting index either.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_owner_ts
  ON activity_logs (owner_id, timestamp DESC);
