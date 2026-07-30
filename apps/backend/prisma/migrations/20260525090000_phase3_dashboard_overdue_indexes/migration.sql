CREATE INDEX IF NOT EXISTS "rent_obligations_owner_id_hostel_id_status_due_date_idx"
  ON "rent_obligations"("owner_id", "hostel_id", "status", "due_date");

CREATE INDEX IF NOT EXISTS "payments_obligation_id_idx"
  ON "payments"("obligation_id");
