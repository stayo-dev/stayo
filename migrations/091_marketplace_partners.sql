-- 091_marketplace_partners.sql
--
-- Marketplace partner listings: an off-platform hostel owner who receives
-- real enquiries on their Stayo-authored listing, free up to a quota, after
-- which further enquiries are HELD and visible-but-locked until they
-- activate a Stayo owner account.
--
-- Reverses, deliberately and with evidence, the rule in
-- src/services/marketing/platform-listing-leads.ts that a platform listing's
-- contact number must never be treated as an opted-in number. That rule is
-- not weakened here — it is satisfied, by making recorded consent a
-- precondition for the partner row existing at all.
--
-- Apply via the Supabase SQL editor or psql. Safe to re-run.

DO $$ BEGIN
  CREATE TYPE "PartnerConsentChannel" AS ENUM (
    'PHONE_CALL',
    'IN_PERSON',
    'WHATSAPP_REPLY',
    'WRITTEN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The consented off-platform owner. One row per person, not per hostel:
-- an owner running three properties is one contact and one consent.
CREATE TABLE IF NOT EXISTS marketplace_partners (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT NOT NULL UNIQUE,
  email              TEXT,

  -- The compliance record. Meta permits business-initiated messages on an
  -- offline opt-in; this is that opt-in, with enough detail to stand behind
  -- if a recipient ever disputes it.
  consent_channel    "PartnerConsentChannel" NOT NULL,
  consent_at         TIMESTAMPTZ NOT NULL,
  consent_by         UUID,
  consent_note       TEXT,

  -- Set when they tap "Stop promotions". Stops every partner template, not
  -- only the marketing ones: someone who asked us to stop and keeps hearing
  -- from us reports us, and one report against the WABA costs more than one
  -- lead.
  opted_out_at       TIMESTAMPTZ,

  -- Permanent bearer secret for /partner/:token. Never expires, unlike the
  -- per-enquiry delivery tokens. Same trade-off as platform_leads.tracking_token.
  portal_token       TEXT NOT NULL UNIQUE,

  converted_owner_id UUID,
  converted_at       TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ
);

-- partner <-> hostel. UNIQUE on hostel_id: a listing has one contact.
CREATE TABLE IF NOT EXISTS partner_listings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   UUID NOT NULL REFERENCES marketplace_partners(id) ON DELETE CASCADE,
  hostel_id    UUID NOT NULL UNIQUE REFERENCES hostels(id) ON DELETE CASCADE,
  -- Per listing, not per partner: a partner's second hostel gets its own
  -- three, because the proof of demand has to be about that building.
  free_quota   INTEGER NOT NULL DEFAULT 3,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_listings_partner
  ON partner_listings (partner_id);

-- The attribution ledger. One row per enquiry, and the only thing that makes
-- "we sent you three students" provable rather than a claim.
CREATE TABLE IF NOT EXISTS partner_lead_deliveries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_listing_id UUID NOT NULL REFERENCES partner_listings(id) ON DELETE CASCADE,
  visitor_lead_id    UUID NOT NULL UNIQUE REFERENCES visitor_leads(id) ON DELETE CASCADE,

  -- PENDING | SENT | HELD | RELEASED | FAILED | EXPIRED.
  -- A plain string, matching this codebase's prevailing convention for
  -- status columns. Transitions live in partner-delivery-state.ts.
  state              TEXT NOT NULL DEFAULT 'PENDING',

  -- Bearer secret for /partner/enquiry/:token — the page that reveals the
  -- student's contact number. Per delivery, so a forwarded link exposes one
  -- enquiry rather than the whole listing.
  delivery_token     TEXT NOT NULL UNIQUE,
  wa_message_id      TEXT,

  sent_at            TIMESTAMPTZ,
  -- Meta's `delivered` webhook. Only THIS consumes free quota; see
  -- partner-quota.ts for why an accepted-but-undelivered send must not.
  delivered_at       TIMESTAMPTZ,
  opened_at          TIMESTAMPTZ,
  responded_at       TIMESTAMPTZ,
  released_at        TIMESTAMPTZ,
  -- When the student was contacted with alternatives because this enquiry
  -- sat HELD too long. A held lead is a person waiting to hear where they
  -- might live; the gate must never strand them to pressure an owner.
  fallback_at        TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ
);

-- Counting confirmed deliveries per listing — the quota check on every enquiry.
CREATE INDEX IF NOT EXISTS idx_partner_deliveries_listing_state
  ON partner_lead_deliveries (partner_listing_id, state);

-- "That is N students this month" in stayo_partner_enquiry_locked.
CREATE INDEX IF NOT EXISTS idx_partner_deliveries_listing_created
  ON partner_lead_deliveries (partner_listing_id, created_at DESC);

-- The 12-hour student fallback sweep. Partial: the cron only ever looks at
-- withheld enquiries nobody has rescued yet.
CREATE INDEX IF NOT EXISTS idx_partner_deliveries_held_fallback
  ON partner_lead_deliveries (created_at)
  WHERE state = 'HELD' AND fallback_at IS NULL;

-- Matching an inbound WhatsApp status webhook back to its delivery.
CREATE INDEX IF NOT EXISTS idx_partner_deliveries_wa_message
  ON partner_lead_deliveries (wa_message_id)
  WHERE wa_message_id IS NOT NULL;
