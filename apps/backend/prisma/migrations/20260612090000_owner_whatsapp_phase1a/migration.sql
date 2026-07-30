CREATE TABLE IF NOT EXISTS owner_whatsapp_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  phone_number TEXT,
  link_code TEXT,
  link_code_expires_at TIMESTAMPTZ,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_identities_owner_id_key
  ON owner_whatsapp_identities (owner_id);

CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_identities_link_code_key
  ON owner_whatsapp_identities (link_code)
  WHERE link_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS owner_whatsapp_identities_verified_phone_key
  ON owner_whatsapp_identities (phone_number)
  WHERE is_verified = true AND phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_owner_whatsapp_identities_phone
  ON owner_whatsapp_identities (phone_number);

CREATE INDEX IF NOT EXISTS idx_owner_whatsapp_identities_verified_phone
  ON owner_whatsapp_identities (is_verified, phone_number);

CREATE TABLE IF NOT EXISTS owner_assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  command TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_assistant_messages_owner_created
  ON owner_assistant_messages (owner_id, created_at);

CREATE INDEX IF NOT EXISTS idx_owner_assistant_messages_phone_created
  ON owner_assistant_messages (phone_number, created_at);

CREATE INDEX IF NOT EXISTS idx_owner_assistant_messages_command_created
  ON owner_assistant_messages (command, created_at);
