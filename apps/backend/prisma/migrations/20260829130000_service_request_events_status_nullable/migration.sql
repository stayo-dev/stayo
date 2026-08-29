-- Lets a service-request ticket carry real two-way chat messages, not just
-- status-change entries. A pure chat message writes status: NULL; a real
-- status transition keeps writing a value exactly as before.

ALTER TABLE "tenant_service_request_events" ALTER COLUMN "status" DROP NOT NULL;
