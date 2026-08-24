-- When the invitation link was successfully delivered over WhatsApp, to
-- `tenant_invitations.phone`. NULL means we cannot vouch for that number:
-- the send failed, it went out by the email fallback instead, or the row
-- predates this column.
--
-- Deliberately records only success. Activation trusts a number when this is
-- set and refuses to when it is not, so every uncertain case — including the
-- rare WhatsApp-failed-then-emailed path — falls into the safe default of
-- asking for an OTP, with no branch of its own.
--
-- No backfill: existing invitations become NULL, which reproduces exactly
-- today's behaviour (always ask for an OTP) rather than silently trusting
-- numbers whose delivery nobody recorded.
ALTER TABLE "tenant_invitations"
  ADD COLUMN IF NOT EXISTS "whatsapp_delivered_at" TIMESTAMPTZ;
