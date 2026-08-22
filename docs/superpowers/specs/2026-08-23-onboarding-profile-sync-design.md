# Onboarding ↔ Stayo profile sync

**Date:** 2026-08-23
**Status:** Approved, ready for planning
**Related:** [[Features]], [[Business-Rules]], [[APIs]], [[Decisions]], `docs/superpowers/specs/2026-08-16-*` (phase B lineage)

## Problem

A person who already has a Stayo account — name, email and phone captured and
the phone verified at signup — is asked for all of it again the moment a hostel
invites them. A person who onboarded to hostel A last year and is now joining
hostel B is asked for *everything* again, because the wizard reads the tenancy
snapshot and a fresh tenancy has none.

## Audit: what already exists

This was audited against live code before designing. Most of the machinery is
built. **None of the following is to be rebuilt.**

| Piece | Location | State |
|---|---|---|
| `profile_identity` — the portable, person-level identity record | `apps/backend/src/services/profile/profile-identity-service.ts` | Live. `IDENTITY_FIELDS`, `CORE_FIELDS`, tenancy fallback, `completion_percent`. |
| `GET`/`PATCH /api/profile/identity` and its editor | `app/api/profile/identity/route.ts`, `apps/frontend/src/app/pages/discover/ProfileEditPage.tsx` | Live. A seeker can fill this in before enquiring anywhere. |
| `GET /api/tenants/me/onboarding-prefill` | `app/api/tenants/me/onboarding-prefill/route.ts` | Live, correct, and has **zero frontend callers**. |
| Residency history across hostels | `src/services/profile/residency-history-service.ts`, `/api/profile/residency-history`, `ResidencyHistoryPage` | Live. Needs no new storage: since migration 062 a `tenants` row *is* one tenancy, so moving out and joining elsewhere accumulates history on its own. |
| Document vault with per-hostel shares | `src/services/profile/document-vault-service.ts` | Live. |
| Server-side skip of phone OTP when the profile phone is already verified | `saveAccount()`, `activation-workflow-service.ts` | Live. |

## Audit: the four real gaps

1. **`getContext()` never reads `profile_identity`.** It returns
   `profile{id,name,email,phone}` plus `tenant.*` — the tenancy snapshot, which
   is empty for a fresh second-hostel tenancy.
2. **The wizard never calls the prefill endpoint**, and as written cannot:
   prefill requires a `TENANT` session, while `/api/tenants/activate` is a
   public token route (`middleware.ts` `PUBLIC_ROUTES`).
3. **The frontend forces an OTP the backend does not require.**
   `canSubmit = otpSent && account.otp.length === 6` in `WelcomeIdentityStep.tsx`
   is unconditional, so an already-verified tenant re-verifies for nothing. The
   Identity form also never shows the person's name and re-asks Gmail as free
   text.
4. **Activation never writes back to `profile_identity`** (zero references in
   the whole workflow service). Hostel A's onboarding therefore teaches the
   person's profile nothing, and hostel B opens blank again.

## Decisions taken

- **Verified account fields are locked with a re-verifying "Change".** Phone
  shows a Verified tick; changing it demands a fresh OTP before submit is
  accepted.
- **Email locks as "from your Stayo account", with no Verified tick.** There is
  no email verification anywhere in this system: `profile` has `phone_verified`
  and `mobile_verified` but no `email_verified`, and `auth-otp-service.ts` is
  phone-only. The only email-verified signal is inside a Supabase JWT and exists
  solely for Google sign-in. Claiming "Verified" would assert something never
  checked. A real email-verification flow is separate, later work.
- **Carried-over details are prefilled with one Confirm for the whole block**,
  every row tap-to-edit.

## Design

### A. One prefill source, read through the invite token

`activationWorkflowService.getContext()` composes
`profileIdentityService.getIdentity(profile.id)` — compose, never recalculate,
per the read-model pattern in `CLAUDE.md`. The returned payload gains one
**additive** key:

```
known: {
  name, email, phone,
  phone_verified,                  // (mobile_verified || phone_verified) AND the phone matches
  identity: { …IDENTITY_FIELDS },
  has_prefill,
  source_of: { field → 'PROFILE' | 'TENANCY' | 'INVITE' }
}
```

`getContext` already resolves the profile from the token via
`resolveInvitation()`, so **no session is required** and
`/api/tenants/activate/context` stays public. This was the blocker on simply
calling the existing prefill route from the wizard.

The existing `profile` and `tenant` keys are unchanged, so nothing downstream
breaks. `/api/tenants/me/onboarding-prefill` stays as it is for the logged-in
preview case; both paths now read the same service and cannot drift.

`source_of` exists so the UI can say *why* a value is there ("from your Stayo
profile" vs "from your invite") rather than presenting owner-typed guesses with
the same confidence as the person's own record. It is **derived, not newly
computed**: `getIdentity()` already returns `pending_backfill_fields` — the
fields it had to read off a tenancy because the backfill has not run for this
person — so a field is `TENANCY` when it appears there, `PROFILE` when the
identity record supplied it, and `INVITE` when only the invitation carried it.

### B. The Identity screen becomes three tiers

1. **Your Stayo account** *(locked)* — name; mobile with a Verified tick and a
   Change that unlocks the field and forces a fresh OTP; email labelled "from
   your Stayo account", Change simply edits. The Gmail-only regex in
   `saveAccount()` is removed — it was enforcing a guess, and it rejects the
   valid non-Gmail addresses the owner captured at invite.
2. **We already know these** *(prefilled, one Confirm)* — date of birth, gender,
   guardian name and phone, permanent address, and college/course *or*
   company/role selected by `profile_type`. Guardian phone keeps its existing
   tick when already verified: `phoneVerificationOtp` lookups are global by
   number and purpose, so a guardian verified at hostel A already reads as
   verified at hostel B with no change required.
3. **New for this hostel** *(asked)* — billing cycle, profile photo if none is
   on file, and anything in `missing_core_fields`.

When `has_prefill` is false — the owner invited someone with no Stayo account,
still the dominant path — tier 2 collapses into the plain form that exists
today. One code path, graceful degradation, no second wizard.

`src/portal/pages/ActivateAccountPage.tsx` also calls `getActivationContext`.
It is **frozen legacy** (`scripts/check-architecture.mjs` enforces the
allowlist) and is no longer the mounted route. It is not touched; the additive
payload leaves it working.

### C. Remove the false OTP gate

`canSubmit` becomes: OTP is required only when the phone is unverified **or**
the tenant changed it in this session. `saveAccount()` already implements
precisely this rule server-side — today the frontend is stricter than the
server for no reason.

### D. Write-back — what makes the second hostel work

`saveProfile()` writes only the `tenants` snapshot. Add a `profile_identity`
upsert inside the same transaction, mirroring the pattern
`/api/tenants/me/complete-profile` already uses.

**Rule:** the `tenants` row remains the immutable snapshot of what was true when
that stay began — agreements and residency history depend on that — while
`profile_identity` holds the person's current truth.

Change-management is **not** involved. Category B in
`src/services/change-management/field-classification.ts` governs *owner-proposed*
edits to a person-level field, which is a different act from a tenant filling in
their own record; the tenant can already edit these freely through
`PATCH /api/profile/identity`.

Without D, gaps 1–3 make one onboarding pleasant and every later one blank.

### E. Testing

`apps/frontend` is node-environment only. Tier logic goes in a pure
`onboardingPrefill.ts` with a colocated `.test.ts`: given a context, which
fields are locked, prefilled, or asked, and whether OTP is required.
`WelcomeIdentityStep` stays a thin renderer over it. No `.test.tsx`.

Backend:
- `getContext` composes identity and reports `source_of` correctly for a person
  with a profile record, without one (tenancy fallback), and with neither.
- `saveProfile` writes both the tenancy snapshot and `profile_identity`.
- The load-bearing case: activate at hostel A, move out, invite to hostel B,
  assert the context comes back prefilled from the person, not the new tenancy.

Any new backend test file must be added to `vitest.pure.config.ts`'s explicit
include allowlist, or it silently never runs.

### F. Out of scope

- **Email verification** — its own piece of work, per the decision above.
- **Document-vault re-sharing to the new hostel** — already built, separate surface.
- **Residency history** — already built, and already accumulates on move-out.

## Documentation to update in the same change

`docs/obsidian/Features.md`, `Business-Rules.md` (the snapshot-vs-current-truth
rule), `APIs.md` (the `known` key on the activation context), `Changelog.md`,
and `Decisions.md` (an ADR for locking verified fields and for declining to
claim email verification).
