CREATE TABLE "public"."room_activity_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "room_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "previous_value" TEXT,
  "new_value" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "room_activity_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "room_activity_logs_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "room_activity_logs_room_id_idx" ON "public"."room_activity_logs"("room_id");
CREATE INDEX "room_activity_logs_owner_id_idx" ON "public"."room_activity_logs"("owner_id");
