-- One live tenancy per phone number, enforced by the database.
--
-- Application-layer guards resolved a phone to a *profile* and then inspected
-- that profile's tenancies. Adoption used to leave `profile_id` null, so an
-- owner-managed tenancy was invisible to all of them: in production one phone
-- reached three tenancies in a single hostel, the third invite accepted two
-- minutes after the adoption.
--
-- The application now links a profile at adoption and also checks by phone, but
-- neither guard is a guarantee -- a future code path can forget both. This is
-- the guarantee.
--
-- Only ACTIVE and INVITED count as live. A FORMER_TENANT, CANCELLED or EXPIRED
-- tenancy must never block a returning resident.
--
-- NOTE: this index is REJECTED while violating rows exist. Find them with:
--
--   SELECT phone_1, count(*), array_agg(id)
--   FROM tenants
--   WHERE status IN ('ACTIVE','INVITED') AND phone_1 IS NOT NULL
--   GROUP BY phone_1 HAVING count(*) > 1;
--
CREATE UNIQUE INDEX "tenants_one_live_tenancy_per_phone"
  ON "tenants" ("phone_1")
  WHERE "status" IN ('ACTIVE', 'INVITED') AND "phone_1" IS NOT NULL;
