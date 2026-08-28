# Owner-Managed Tenants (Phase 2) — Claiming a Tenancy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Let a tenant whose records their owner has been keeping claim that tenancy later — proving possession of the phone number by OTP — and continue with every obligation, payment and receipt already on the record.

**Architecture:** Claiming attaches an identity to an existing tenancy rather than creating one. Every financial record hangs off `tenant_id`, never `profile_id`, so history survives for free. The tenancy flips `OWNER_MANAGED → SELF_SERVE`, gains a `profile_id`, and captures a real `TenantPolicyAcceptance` at that moment — the first genuine tenant consent in its life.

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres (Supabase), Vitest, React 19 + Vite, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md` §7

## Global Constraints

- **The claim is always OTP-gated, and the skip path is never proof.** `authOtpService.sendPhoneOtp` returns `verification_required: false` and writes a `SKIPPED` row when WhatsApp is unavailable (`lib/services/auth/auth-otp-service.ts:254`). A claim that accepts that would let anyone claim any tenancy whenever WhatsApp is down. The claim endpoint MUST independently confirm a `phoneVerificationOtp` row with `status: "VERIFIED"` (never `SKIPPED`), matching phone AND the claim's own dedicated purpose, within a short freshness window. A client-supplied "verified" flag is never trusted.
- **Never auto-link.** The tenant must see what they are about to claim — hostel, room, owner, start date — and confirm. Multiple matches show a picker, never a guess.
- Phones are compared as E.164 via `normalizeIndianPhone` (backend) / `canonicalPhone` (frontend). Every identity write and lookup goes through it.
- `hostelId` required, never optional; no first-hostel fallback (`npm run check:invariants`).
- Backend pure tests must be added to `vitest.pure.config.ts`'s `include` allowlist or they never run.
- Frontend tests are node-environment only — no jsdom, no `.test.tsx`, no component rendering.
- All frontend API calls go through `@lib/api-client`.
- Do not connect to the database; it is unreachable and is production. The Phase 1 migration is still unapplied.
- Baselines: backend `tsc` **534** errors, `check:invariants` **2 FAILs**, `test:pure` **977 passed / 2 failed**; frontend **1591 passed**, `check:architecture` and `build` pass.

---

### Task 1: Claim eligibility — pure decision logic

The rules for what may be claimed, isolated from I/O so they are testable.

**Files:**
- Create: `apps/backend/lib/tenants/claim-eligibility.ts`
- Create: `apps/backend/tests/claim-eligibility.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Produces:**
- `isClaimable(t: ClaimCandidateLike): boolean`
- `isOtpProofValid(proof: OtpProofLike, now: Date): boolean`
- `CLAIM_OTP_PURPOSE = "TENANCY_CLAIM"`
- `CLAIM_PROOF_MAX_AGE_MS`

Rules to encode and test:
- Claimable requires `access_mode === "OWNER_MANAGED"` AND `status === "ACTIVE"`. A `FORMER_TENANT`, `CANCELLED` or `EXPIRED` tenancy is not claimable; a `SELF_SERVE` tenancy is not claimable (it already has an owner-of-record identity).
- Proof is valid only when `status === "VERIFIED"` — `"SKIPPED"` and `"PENDING"` are both invalid, and this must have its own explicit test naming the skip path as a security case.
- Proof must match the claim purpose exactly, and be no older than the freshness window.
- Write the tests first, watch them fail, then implement.

---

### Task 2: Claim lookup and confirm services + endpoints

**Files:**
- Create: `apps/backend/src/services/tenants/tenancy-claim-service.ts`
- Create: `apps/backend/app/api/tenancy-claim/lookup/route.ts`
- Create: `apps/backend/app/api/tenancy-claim/confirm/route.ts`

**Consumes:** Task 1's helpers; `normalizeIndianPhone`; `resolveTenantName`.

`lookup({ phone, requestIp })` — requires valid OTP proof for `CLAIM_OTP_PURPOSE`, then returns the claimable tenancies for that canonical phone as **display data only**: `{ tenant_id, hostel_name, room_no, joined_on, owner_name, monthly_rent }`. It must NOT return obligations, balances, or anything financial — a lookup is pre-authentication and must not leak a stranger's money.

`confirm({ tenantId, phone, profileId | newProfileInput, requestIp })` — in ONE transaction:
1. Re-validate the OTP proof (do not trust that lookup ran).
2. Re-check `isClaimable` and that the tenancy's canonical `phone_1` still equals the verified number.
3. Attach identity: use the caller's existing profile if authenticated, else find a profile by that canonical phone, else create one. **Reuse the existing marketplace-profile-reuse path rather than writing a second one** — find it before you write anything.
4. Set `profile_id`, `access_mode = "SELF_SERVE"`, `mobile_verified = true`.
5. Write a real `TenantPolicyAcceptance` against the hostel's current rule version.
6. Return the tenancy summary.

Routes are public (pre-auth) but rate-limited like the other OTP-adjacent routes — follow `send-phone-otp`'s idiom. Error codes: `OTP_PROOF_REQUIRED` 401, `NOT_CLAIMABLE` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400.

---

### Task 3: Make a superseded invitation claimable, and close the forged-consent guard

Two Phase-1 deferrals that become load-bearing now.

**Files:**
- Modify: `apps/backend/src/services/tenants/tenant-invitation-lifecycle-service.ts` (`resolveByToken`, ~line 886)
- Modify: `apps/backend/src/services/tenants/owner-managed-tenancy-service.ts` (the comment corrected in Phase 1)
- Modify: `apps/backend/scripts/activation-invariants-check.ts`

1. A `SUPERSEDED` invitation whose tenancy is `OWNER_MANAGED` currently throws `INVALID: Activation link expired or already used`. Spec §6 requires that link to route the tenant to the **claim** flow instead. Make `resolveByToken` distinguish the two: still invalid for a genuinely consumed invitation, but for one superseded by adoption return a result the route can turn into a claim redirect. Do not weaken the check for any other status.
2. Add the fourth conditional invariant the spec's §5 lists and Phase 1 omitted: no tenant may hold a `TenantPolicyAcceptance` while `access_mode = OWNER_MANAGED`. Phase 2 makes this reachable, because claiming writes a real acceptance — a bug that flipped a claimed tenancy back to owner-managed would otherwise leave forged-looking consent in place undetected.
3. Note the Phase-1 finding that this invariant's sibling check ("OWNER_MANAGED must not hold a linked auth identity") will hard-fail for a legitimately revoked tenant once Revoke exists. Revoke is not in this phase; leave the check but record the interaction in the vault.

---

### Task 4: The tenant-facing claim flow

**Files:**
- Create: `apps/frontend/src/platforms/tenant/claim/claimSteps.ts` + `claimSteps.test.ts` (pure step machine)
- Create: `apps/frontend/src/platforms/tenant/claim/ClaimTenancyPage.tsx`
- Create: `apps/frontend/src/features/tenant-session/api/tenancyClaim.ts`
- Modify: the tenant route tree to mount the page

Steps: phone → OTP → **confirmation card** → done. The confirmation card is the heart of it: it shows hostel, room, move-in date and owner name, and says plainly that confirming links this record to their account. Multiple matches render a picker before the card.

The pure `claimSteps.ts` owns which step is current and what may advance it; the page is a thin renderer over it. Put every branch decision in the `.ts` and test it there — no `.test.tsx`.

On success, route into the tenant portal, where their existing obligations and receipts are already waiting.

---

### Task 5: Owner notification and documentation

- Notify the owner that the tenant has joined, reusing the existing notification service rather than a new one. Find how other owner-facing notifications are dispatched and follow it.
- Update `docs/obsidian/`: [[APIs]] (two new routes), [[Business-Rules]] (the claim rules and the skip-path security rule), [[Features]], [[Decisions]] (an ADR for phone-as-identity and why the skip path is never proof), [[Changelog]], and clear the Phase 2 items from [[TODO]].

---

## Verification

Backend: `npm run test:pure`, `npx tsc --noEmit`, `npm run check:invariants`.
Frontend: `npx vitest run`, `npm run check:architecture`, `npm run build`.
All against the baselines in Global Constraints. Every DB-dependent check remains unrunnable and must be reported as such, not assumed.
