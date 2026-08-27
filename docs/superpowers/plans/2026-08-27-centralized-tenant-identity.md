# Centralized Tenant Identity — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** One profile per human, keyed on verified phone. An owner-managed tenancy is a profile *without a login* — never a tenancy without a profile.

**Why:** production has three tenancies on one phone, one hostel, because adoption left `profile_id` null and every duplicate guard in the system keys on `profile_id`. Adoption at 16:31:56 was invisible to the eligibility check, which let a second invite through at 16:34:09.

## Global Constraints

- **`display_name` is a fallback, never the source of truth.** Identity lives on `profiles`, resolved by canonical phone (`normalizeIndianPhone`, E.164).
- **Never create a second profile for a phone that already has one.** Reuse, always.
- A profile created for an owner-managed tenancy has `auth_user_id: null` and `password_hash: null` — it cannot log in, which is the entire distinction. It is not "inactive".
- No behaviour change for `SELF_SERVE` tenancies.
- Baselines: backend `tsc` 529, `check:invariants` 2 FAILs, `test:pure` 1110 passed / 2 failed; frontend 1693 passed + 1 unrelated collection failure, `check:architecture` + `build` pass.
- Do not connect to the database. Do not modify production data — the user owns that.

---

### Task 1: Adoption creates or links a profile

**File:** `apps/backend/src/services/tenants/owner-managed-tenancy-service.ts`

Inside the existing transaction, before setting the tenancy `ACTIVE`:
1. Canonicalise `phone_1`.
2. Find a profile by that phone. If found, **reuse it** — set `profile_id` to it. Do not touch its `password_hash`, `auth_user_id`, `email` or `role`.
3. If none, create one: `role: TENANT`, `phone`, `name` from the resolved display name, `auth_user_id: null`, `password_hash: null`. `profile.email` is required and unique — follow the placeholder convention the claim flow already uses (`<e164>@hms.temp`), and prefer a real email when the invitation carries one.
4. Set `tenants.profile_id`. Keep writing `display_name` as a fallback.
5. If the found profile is not `role: TENANT`, refuse with a distinct code rather than mutating it.

Reuse the marketplace-profile-reuse logic that already exists — find it before writing new code.

### Task 2: Eligibility must see tenancies by phone, not only via profile

**File:** `apps/backend/src/services/tenants/tenancy-eligibility-service.ts`

`resolveProfileIdByContact` returns null when no profile exists, and `checkEligibilityByContact` then returns `{ eligible: true }`. That is the hole. Add a direct check: a **live** tenancy (`ACTIVE` or `INVITED`) whose `phone_1` matches the canonical number makes the contact ineligible, whether or not a profile links them.

Keep the existing OWN/OTHER disclosure scoping — an owner must not learn details of a tenancy at a hostel that isn't theirs beyond that a conflict exists. Add pure tests for: orphaned owner-managed tenancy blocks, same-hostel duplicate blocks, `FORMER_TENANT`/`CANCELLED` does not block.

### Task 3: Claiming must still work once tenancies carry a profile

**File:** `apps/backend/lib/tenants/claim-eligibility.ts`

`isClaimable` currently refuses a tenancy whose `profile_id` is set and is not the caller's. After Task 1 **every** owner-managed tenancy has a `profile_id`, so this would refuse every claim — Phase 2 breaks entirely.

New rule: claimable when `OWNER_MANAGED` + `ACTIVE` **and** either the bound profile has no `auth_user_id` (a login-less shell — exactly what adoption creates), or it is already the claimant's own profile. A tenancy bound to a profile that *can* log in is not claimable. Update the tests, including one named for this regression.

### Task 4: Validate at the phone field, not at submit

**Files:** `apps/frontend/src/features/owner-tenants/invite/InviteTenantWizard.tsx`, `hooks/useInviteWizard.ts`, plus a pure module for the decision logic.

`checkEligibilityByContact` is already built for debounced per-keystroke calls. Wire it to the phone input on the Tenant step: on a complete number, check, and render the outcome inline — "Already a tenant at Sri Adithya, Room 201" — and block advancing past that step. The owner must learn this while typing, not after four screens.

Decision logic goes in a pure `.ts` with tests; the component stays a renderer. Keep the submit-time guard as the safety net.

### Task 5: Owner-managed becomes a post-invite choice

**Files:** the invite wizard, and the invite success screen.

Remove the wizard's "Just add to my records" exit. Whether a tenant uses the app is not the owner's decision to make upfront.

After an invitation is sent, the success screen asks: **wait for them to activate**, or **keep the records yourself meanwhile**. The second calls the existing adopt endpoint on the tenancy just created. Same tenancy either way — nothing to reconcile later, and the invitation stays claimable.

Keep the existing adopt entry point on the invited-tenant screen; this adds a second moment to make the same choice, at the point the owner is actually thinking about it.

### Task 6: The database constraint

**File:** a new migration.

A partial unique index on canonical `phone_1` for live tenancies (`status IN ('ACTIVE','INVITED')`), so no code path can recreate this state.

**This migration will be REJECTED until production data is cleaned** — `+918008046952` currently holds both an `ACTIVE` and an `INVITED` tenancy. Ship the migration; do not attempt to apply it. Document in the migration's own comment that it requires prior cleanup, and put the detection query in the docs so the user can find violators themselves.

### Task 7: Documentation

Update `docs/obsidian/`: [[Database]] (the constraint, profile linkage), [[Business-Rules]] (one profile per human, phone as the key, what owner-managed now means), [[Bugs]] (this defect and its mechanism), [[Decisions]] (an ADR superseding the earlier "display_name on the tenant row" choice — say plainly that it was wrong and why), [[Changelog]].
