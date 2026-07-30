CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE whatsapp_logs
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
