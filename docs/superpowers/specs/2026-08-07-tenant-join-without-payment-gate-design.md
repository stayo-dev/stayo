# Tenant joins without paying: removing the onboarding payment gate and making tenancy multi-hostel-capable

**Date:** 2026-08-07
**Status:** Approved, implementing
**Branch:** `feat/tenant-join-without-payment-gate`

## Problem

Two problems, one activation path, so one spec.

### 1. A tenant cannot get a bed until they pay

The current system treats the security deposit plus maintenance charge as a single
"onboarding charge" that must be cleared before a room is assigned. The rule lives in
one derived read model and is enforced in four places:

| Where | What it does |
|---|---|
| `src/services/tenants/reservation-status-service.ts` | Derives `PAYMENT_PENDING` → `RESERVED` → `MOVE_IN_READY` from deposit + maintenance paid vs. a threshold. Not a stored column. |
| `tenant-invitation-lifecycle-service.ts` (~L1046) | On activation, creates the `roomAllocation` **only if** status `!== 'PAYMENT_PENDING'`. This is the actual gate. |
| `tenant-invitation-lifecycle-service.ts` (~L1188) | `allocateOnboardingTenantIfFinanciallyReady` — retroactively allocates once money lands. |
| `lib/services/room-capacity-service.ts` (L54, L212) | A `PAYMENT_PENDING` tenant does not count as occupying the bed. |

Plus `lib/services/move-out-service.ts:225` (blocks move-out while `PAYMENT_PENDING`) and
`TenantProfilePortalPage.tsx:952` (hides residency info until `RESERVED`).

Stayo is moving to a universal platform with many independent owners. Owners collect
deposits and maintenance on their own terms, usually **after** the tenant has moved in.
Gating the bed on payment is wrong for that market.

### 2. A person can only ever belong to one hostel — permanently

`tenants.profile_id` is `@unique` (`prisma/schema.prisma:1330`). One person can have at most
one `tenants` row, **ever**. Invitation creates a fresh row with `profile_id: null`
(`tenant-invitation-lifecycle-service.ts:309`); activation links the profile to it (L962).

Consequences:

- A `FORMER_TENANT` who has moved out and settled **cannot** be invited to a second hostel:
  `tenant-invitation-lifecycle-service.ts:256` rejects them with
  `ALREADY_EXISTS: User with this email already exists`, and even past that check the unique
  constraint would fail at activation.
- Two owners can both invite the same person; whoever's link is clicked second gets a raw
  `ALREADY_ACTIVE` error or a Prisma constraint violation.

"One hostel at a time" is currently implemented as "one hostel, forever".

## Live-data audit (2026-08-07)

Pre-launch; the database holds development data only.

| Fact | Value |
|---|---|
| Hostels / active rooms | 2 / 6 |
| `ACTIVE` tenants | 10 — all allocated, all deposit-cleared (`MOVE_IN_READY`) |
| `INVITED` tenants | 3 — with ₹48,000 in `PENDING` `SECURITY_DEPOSIT` obligations |
| `FORMER_TENANT` | 0 |
| `move_out_requests`, ever | 0 |
| `TENANT`-role profiles with no tenancy (marketplace accounts) | 2 |

Two things follow. The move-out → settlement → re-join path has **never executed**, so tests
are its only safety net. And no backfill or compatibility window is needed: every existing
profile has exactly one tenancy, so the new partial unique index applies cleanly on day one.

## Decisions

1. **Deposit and maintenance become ordinary dues, payable immediately on joining.** No grace
   period, no product lockout. Owners chase them the way they chase rent.
2. **The `PAYMENT_PENDING` / `RESERVED` / `MOVE_IN_READY` vocabulary is deleted outright.** The
   tenant lifecycle is `INVITED` → `ACTIVE` ("Joined") → vacating → `FORMER_TENANT`. Onboarding
   dues surface only as money owed, through the existing financial read model. No parallel
   status vocabulary.
3. **A `tenants` row means one tenancy, not one person.** Approach A of three considered
   (below).
4. **Re-join requires a `move_out_requests` row in `COMPLETED`** on every prior tenancy.
   `FORMER_TENANT` alone is not enough — it can be set at the exit date while settlement money
   is still outstanding.
5. **Accepting an invitation voids every other live invitation** for that person, releasing
   their room reservations back to capacity and notifying those owners.
6. **Invite-time disclosure is scoped to ownership.** If the person already lives in one of the
   inviting owner's own hostels, name it. If they live at another owner's property, say only
   that they are "currently a tenant at another property on Stayo" — no hostel name, no owner,
   no location.

### Approaches considered for the tenancy model

- **A — Tenancy-per-row (chosen).** Drop `profile_id @unique`; add a partial unique index over
  live statuses. Each stay is its own row with its own money history. ~8 call sites move to an
  `activeTenancy()` helper. Matches how this repo already treats obligations: append, never
  mutate history.
- **B — Mutate the existing row on re-join.** No schema change; overwrite `hostel_id`/`owner_id`.
  Rejected: Hostel A's payments, obligations, agreements and move-out records follow the tenant
  into Hostel B and become visible to the new owner.
- **C — Separate `tenancies` table.** Rejected: creates a second source of truth for the same
  fact, a failure mode this codebase has already suffered (see
  `docs/business-logic/financial-consistency-investigation-report.md`).

## Design

### Data model

```sql
-- profile_id is no longer globally unique
DROP INDEX IF EXISTS tenants_profile_id_key;
CREATE INDEX IF NOT EXISTS tenants_profile_id_idx ON tenants (profile_id);

-- but a person may hold only ONE live tenancy at a time
CREATE UNIQUE INDEX tenants_one_live_tenancy_per_profile
  ON tenants (profile_id)
  WHERE profile_id IS NOT NULL AND status IN ('INVITED', 'ACTIVE');
```

The partial index also closes the rival-invite race at the database level: activation is what
sets `profile_id`, so two owners cannot both drive the same person to activation.

Prisma's `profile.tenants` becomes a list. The field is already named plural, so no rename is
needed — only the 8 `include: { tenants: true }` sites, which all route through a new
`lib/tenancy/active-tenancy.ts` exposing `getActiveTenancy(profileId, tx?)` and
`requireActiveTenancy(profileId, tx?)`.

**Columns deleted**, because they exist only to compute the gate threshold:
`tenants.reservation_policy`, `tenants.minimum_reservation_deposit`, the hostel-level
`minimum_reservation_deposit` policy in `lib/services/hostel-policy-service.ts`, and the
`minimum_deposit_threshold` field on the invite API.

**Accepted cost:** "reserve a bed with a token amount" stops being expressible. Free to do
pre-launch; reinstating it later would be a new feature, not a revert.

### Removing the gate

- `completeActivation` allocates the room unconditionally. The room-capacity check stays — that
  is overbooking protection, not a payment gate.
- `allocateOnboardingTenantIfFinanciallyReady` and its payment-service caller are deleted;
  retroactive allocation is meaningless once allocation is unconditional.
- `room-capacity-service`: occupied = active allocations of `ACTIVE` tenants. This deletes a
  per-tenant `getReservationStatus` call inside a loop (an N+1) and the duplicated
  `isPaymentPending` block in `getHostelCapacityMap`.
- `reservation-status-service.ts` and `activation-financial-enforcement-service.ts` are deleted.
  The latter is already referenced by nothing but its own test.
- `activation-financial-status-service.ts` **stays** — it is also the "how much deposit is still
  owed" calculator behind deposit payment intents (`payment-service.ts:1769`) and the tenant CSV
  export. Only its threshold fields go.
- Deposit and maintenance obligations need no change: already created at invite, already
  `PENDING`. They stop being a gate and become dues.
- `move-out-service.ts` drops its `PAYMENT_PENDING` guard.

### One live tenancy

New `src/services/tenants/tenancy-eligibility-service.ts` — the single answer to "can this
person start a tenancy?", with the rules themselves as pure functions over plain data.

- **Invite time** → `409 TENANT_HAS_ACTIVE_TENANCY` with
  `{ scope: 'OWN' | 'OTHER', hostelName?, roomNumber?, tenantId? }`. Replaces today's misleading
  `ALREADY_EXISTS: User with this email already exists`.
- **Acceptance** → other live invitations voided, `tenant_invitation_reservations` released with
  `release_reason: 'JOINED_ELSEWHERE'`, owners notified.
- **Session** → `lib/auth/supabase-session.ts` resolves the *active* tenancy rather than *the*
  tenancy.

### Re-joining

`assertCanStartNewTenancy(profileId)`: no live tenancy, and every prior tenancy has a
`move_out_requests` row in `COMPLETED`. Otherwise `PREVIOUS_TENANCY_NOT_SETTLED`. A new stay is a
new `tenants` row; the old row keeps its own payments, obligations, agreements and allocations,
invisible to the new owner.

### UI

- Delete `TenantReservationCard.tsx`.
- `TenantStatusBadge`: remove the three reservation entries; label `ACTIVE` as **"Joined"**.
- `OnboardingProgressTracker`: drop the payment step.
- `TenantProfilePortalPage`: residency sections unconditional.
- `TenantMoveOutPage`: remove the `PAYMENT_PENDING` early return.
- Owner invite modal: dialog for `TENANT_HAS_ACTIVE_TENANCY`, respecting the disclosure scope.

Net effect: activation → full dashboard, assigned room, profile, service requests, and rent
payment.

### Testing

Eligibility and status rules are pure functions over plain data so they run under
`npm run test:pure`. New test files **must** be added to the `vitest.pure.config.ts` include
allowlist — it is an explicit allowlist and silently skips anything absent.

DB-backed tests cover the five behaviours only the database can prove:

1. Allocation happens on activation despite unpaid deposit and maintenance.
2. An unpaid joiner counts against room capacity.
3. The partial unique index rejects a second live tenancy for one profile.
4. Re-join is blocked until the prior move-out is `COMPLETED`, and allowed after.
5. Accepting one invitation voids the others and releases their reservations.

Deleted as no longer meaningful: `activation-financial-enforcement-service.test.ts`,
`integration/tenant-onboarding-financial-gating.test.ts`. Updated:
`activation-enforcement-coverage.test.ts`, `room-capacity-service.test.ts`,
`move-out-authorization.test.ts`, `whatsapp-onboarding-notification.test.ts`.

Also run: `npm run check:invariants`, `npm run check:financial-safety`, and the frontend
`npm run check:architecture` / `npm run build`.

### Documentation

Updated in the same change: `docs/obsidian/` — `Features`, `Changelog`, `Business-Rules`,
`Database`, `APIs`, and two ADRs in `Decisions` (payment-gate removal; tenancy-per-row) — plus
`docs/data-models/schema.md`.

## Out of scope

- Bed-level allocation (no bed-number concept exists yet).
- Any per-hostel policy for *when* onboarding dues fall due — they are due on joining.
- Reinstating partial/token-deposit reservations.
