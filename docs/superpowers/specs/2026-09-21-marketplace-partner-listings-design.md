# Marketplace Partner Listings — design

Date: 2026-09-21
Status: approved, implementation started
Branch: `feat/marketplace-partner-listings` (worktree, off `origin/dev`)

## 1. The problem

Stayo authors marketing pages for hostels whose owners have no Stayo account
(`hostels.listing_source = PLATFORM_LISTED`, owned by the sentinel "Stayo
Platform" profile — migration 068). Today a tenant enquiry on such a listing
raises a `platform_leads` row for the sales team and **nothing reaches the
actual hostel owner**. The enquiry is treated purely as demand evidence.

That wastes the asset. The owner is the one person who would act on the
enquiry immediately, and the enquiry is the only argument that will ever make
them join.

## 2. What we are building

A **marketplace partner**: an off-platform hostel owner who receives real
enquiries on WhatsApp, for free, up to a quota — after which further enquiries
are held and visible-but-locked until they activate a Stayo owner account.

The product's job is to manufacture **attributable proof of demand** and then
withhold the next piece of it.

### Deliberate reversal of an existing decision

`src/services/marketing/platform-listing-leads.ts` currently documents:

> A platform listing's contact number belongs to the business, not to a person
> who agreed to be contacted by us. Copying it into a lead's `phone` would let
> the outreach tooling treat it as an opted-in number.

That reasoning stands. This design does not weaken it — it **satisfies** it, by
requiring recorded consent before a partner row can exist at all. The listing's
`hostels.phone` is still never used for outreach. `marketplace_partners.phone`
is a separate, consented number.

## 3. Decisions taken (with the user, 2026-09-21)

| Decision | Choice |
|---|---|
| "Manager" invitations | Platform staff joining the admin console (`platform_admins`), not hostel-level managers |
| Lead delivery | WhatsApp to the owner; contact exchange happens on a Stayo-hosted token page. The owner's number is never shown on the public listing |
| The gate | Enquiry N+1 is **held, and the owner is told it exists**. Nothing is discarded |
| Opt-in | Admin captures consent (phone/in-person) at listing time, with a stored audit row. Meta's offline opt-in standard |
| Partner account | Tokenised bearer link, **no login**. Creating credentials happens for the first time at conversion, so onboarding reads as an upgrade |
| Free quota | **3 delivered enquiries**, counted per listing |

## 4. Architecture

### 4.1 Why three new tables and not a reuse of `platform_leads`

`platform_leads` is the **sales pipeline**; a partner is the **recipient of
leads**. They are different entities with different lifetimes. Two concrete
reasons reuse breaks:

1. `platform_leads_one_active_lead_per_phone` (migration 078) permits one
   active lead per phone. An owner with two hostels needs two listings and one
   contact — impossible in that table.
2. `platform_leads.status` is a sales funnel (`NEW → CONTACTED → … → LIVE`).
   "Has received 2 of 3 free enquiries" is not a point on it.

`platform_leads` is untouched by this work and continues to serve the sales
console.

### 4.2 Tables

```
marketplace_partners      the consented off-platform owner.
                          name, phone (unique), email,
                          consent audit (channel/at/by/note),
                          opted_out_at, portal_token,
                          converted_owner_id, converted_at

partner_listings          partner <-> hostel. A partner may hold several.
                          hostel_id unique. free_quota (default 3).

partner_lead_deliveries   the attribution ledger. One row per enquiry.
                          visitor_lead_id unique, state, delivery_token,
                          wa_message_id, sent/delivered/opened/responded/
                          released/fallback timestamps.
```

`partner_lead_deliveries` is what makes "we sent you three students" provable.
Without it neither the gate nor the sales pitch can exist.

Statuses are plain strings, matching this codebase's prevailing convention
(see CLAUDE.md — many status columns are not Prisma enums). `consent_channel`
**is** an enum, because it is a closed set used for compliance evidence and
must not drift.

### 4.3 Delivery state machine

```
                        quota available
   enquiry ──────────► PENDING ──delivered webhook──► SENT ──► (consumes quota)
      │                   │
      │                   └──failed/expired webhook──► FAILED / EXPIRED
      │
      └─ quota exhausted ► HELD ──partner converts──► RELEASED
```

**Quota is counted on `SENT` only — never on API acceptance.**

Every partner template carries a 12-hour Meta validity period. An undelivered
message is silently dropped and never seen. If acceptance consumed quota, an
owner whose phone was off would hit the paywall having genuinely received two
enquiries while the message claimed three — the gate would read as a swindle at
the exact moment it must read as fair.

**The gate errs toward generosity, by design.** Because only `SENT` counts,
several enquiries arriving inside one delivery window can all be delivered
free. Over-delivering a free lead is a benign failure; paywalling someone who
received nothing is not.

### 4.4 The student must never be stranded

A held enquiry is a real person waiting to hear where they might live.
Suppressing that to pressure an owner damages the demand side — the harder side
to rebuild — to coerce the supply side.

**Rule:** if a `HELD` delivery is not released within **12 hours**, the student
is contacted by Stayo with nearby alternatives, which are onboarded owners'
hostels. `fallback_at` records this. The gate therefore doubles as a
lead-redistribution engine that rewards owners who joined.

This rule is not optional and not a later phase.

### 4.5 Conversion

Reuses the already-written, currently-unwired `canClaimListing()` /
`buildClaimUpdate()` in `src/services/marketing/platform-listing-rules.ts`.
There is no claim API route today; this design adds one. On claim:
hostel moves to `OWNER_MANAGED`, every `HELD` delivery flips to `RELEASED`,
and `stayo_partner_activated` fires with the released count.

## 5. Manager (platform staff) invitations

`POST /api/platform-admin/admins` currently mints a `password_hash` and returns
a plaintext temporary password in the JSON body for out-of-band sharing. Two
problems: a shared temp password is a weak credential, and minting
`password_hash` contradicts the standing Clerk-only-auth rule (ADR-204).

Replaced with: `platform_admin_invitations` (token + expiry, mirroring
`platform_lead_invitations`) → `stayo_admin_invitation` on WhatsApp →
activation page → Clerk sign-up **bound to the invited email**.

That email binding is the security control that makes a forwardable WhatsApp
link safe: possession of the link alone grants nothing.

### `PlatformAdminTitle` gains `MANAGER`

The approved template's `{{2}}` is a role label and its review sample is
`manager`, but the enum is `OWNER | SALES | VERIFICATION` — there is no value
that renders as "manager". Adding `MANAGER` is the honest fix. A label map
(`OWNER → "Owner"`, …) keeps raw enum values such as `VERIFICATION` out of
customer-visible copy.

## 6. Meta templates

All approved in the Stayo WABA on 2026-09-21 unless noted. Bodies are recorded
in `partner-template-contracts.ts` / `admin-invitation-template-contracts.ts`
as the declared parameter shape, pinned by a pure test — the same guarantee
`platform-lead-template-contracts.ts` gives.

| Key | Meta name | Category | Params | Button |
|---|---|---|---|---|
| `ADMIN_INVITATION` | `stayo_admin_invitation` | UTILITY | admin_name, title_label, inviter_name, expiry_days | dynamic URL, activation token |
| `ADMIN_INVITATION_REMINDER` | `stayo_admin_invitation_reminder` | UTILITY | admin_name, expiry_human | dynamic URL, activation token |
| `PARTNER_LISTING_LIVE` | `stayo_partner_listing_live` | MARKETING | owner_name, hostel_name, city | dynamic URL, portal token |
| `PARTNER_NEW_ENQUIRY` | `stayo_partner_new_enquiry` | UTILITY | owner_name, hostel_name, student_name, move_in, delivered_count, free_quota | dynamic URL, delivery token |
| `PARTNER_ENQUIRY_LOCKED` | `stayo_partner_enquiry_locked` | MARKETING | owner_name, hostel_name, total_enquiries, free_quota | dynamic URL, activation token; quick reply `Stop promotions` |
| `PARTNER_ACTIVATED` | `stayo_partner_activated` | UTILITY | owner_name, hostel_name, released_count | static URL — **not yet submitted** |

Notes:

- `stayo_partner_new_enquiry` cleared as **UTILITY**. It is the workhorse:
  cheapest rate, highest limits, no marketing frequency cap. Never edit
  promotional language into it — Meta will recategorise and the funnel's
  economics change.
- `stayo_partner_listing_live` was submitted expecting UTILITY and came back
  **MARKETING**. It is therefore a marketing-category message, sent on verbal
  consent, as the first contact a cold owner ever receives — the highest
  block-risk combination in the design.

### Operational recommendation: a second phone number

The WABA already delivers rent reminders, receipts and OTPs to paying
customers' tenants. Partner outreach on the same number puts revenue-operations
delivery behind the quality rating of the coldest possible audience. Partner
templates should send from a **separate phone number on the same WABA** —
separate quality rating, zero blast radius. This is a configuration decision,
not code, and is recorded here so it is not discovered after a rating drop.
The sender number is therefore configurable per template family
(`WHATSAPP_PARTNER_PHONE_NUMBER_ID`), defaulting to the existing number.

## 7. Pre-existing bug this work must fix first

`app/api/platform-admin/platform-listings/route.ts:57` calls
`prisma.leads.groupBy(...)`. There is no `leads` model — the enquiry table is
`visitor_leads`. The `ids.length` guard means it only throws once a platform
listing actually exists, which is why it was never caught: the admin Platform
Listings page 500s the first time a listing is created. Present on both
`origin/main` and `origin/dev`.

## 8. Module boundaries

Decision logic goes in **pure** modules registered in `vitest.pure.config.ts`.
This is not a stylistic preference: the test database is unreachable, so the
main suite cannot run, and pure modules are the only code that can be verified
at all.

Pure:
- `src/services/marketing/partner-quota.ts` — the gate decision
- `src/services/marketing/partner-consent.ts` — may we message this partner
- `src/services/marketing/partner-delivery-state.ts` — state-machine transitions
- `lib/.../whatsapp/partner-template-contracts.ts` — 4 partner templates
- `lib/.../whatsapp/admin-invitation-template-contracts.ts` — 2 admin templates
- `src/services/platform-admin/admin-title-label.ts` — enum → human label

I/O:
- `src/services/marketing/partner-lead-delivery-service.ts`
- `src/services/marketing/partner-claim-service.ts`
- `src/services/platform-admin/admin-invitation-service.ts`

## 9. Metrics

Consent rate per approach · enquiries per live listing per week · **lead-page
open rate** (the real engagement signal, not WhatsApp read receipts) ·
gate-hit rate · **gate → claim conversion (north star)** · time from gate to
claim · and as a guardrail checked before any growth number: **share of held
enquiries where the student got a reply within 24 hours**.

## 10. Out of scope

- `stayo_partner_monthly_digest` — needs listing-view tracking, which has no
  table in the schema. A template with an unfillable parameter is a dead
  template.
- `stayo_admin_access_revoked` — audit nicety, no flow depends on it.
- Proxy/masked telephony. Contact exchange is via the Stayo-hosted page.
- Any pricing claim. The commercial model is undecided; `stayo_partner_enquiry_locked`
  deliberately promises no price, and copy must not acquire one without sign-off.
