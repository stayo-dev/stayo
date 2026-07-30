CREATE TABLE "public"."system_locks" (
  "key" TEXT NOT NULL,
  "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "system_locks_pkey" PRIMARY KEY ("key")
);
