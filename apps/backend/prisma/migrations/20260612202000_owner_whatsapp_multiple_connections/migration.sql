DROP INDEX IF EXISTS owner_whatsapp_identities_owner_id_key;

CREATE INDEX IF NOT EXISTS idx_owner_whatsapp_identities_owner_id
  ON owner_whatsapp_identities (owner_id);
