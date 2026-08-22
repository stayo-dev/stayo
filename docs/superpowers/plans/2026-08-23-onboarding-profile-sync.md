# Onboarding ↔ Profile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tenant onboarding open pre-filled from the Stayo profile the person already has, ask only for what we don't know, and write back what they confirm so the *next* hostel is pre-filled too.

**Architecture:** Two pure modules carry all the decision logic — `onboarding-known.ts` (backend: what do we know, and from where) and `onboardingPrefill.ts` (frontend: which fields are locked / pre-filled / asked, and is an OTP required). Everything else is wiring: `getContext()` composes the existing `profileIdentityService`, `saveProfile()` calls the existing `absorbFromTenancy()`, and `WelcomeIdentityStep` renders the plan. No new tables, no new endpoints.

**Tech Stack:** Next.js 14 App Router + Prisma + Postgres (`apps/backend`), Vite + React 19 (`apps/frontend`), Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-23-onboarding-profile-sync-design.md`

**Worktree:** `/home/sp/Desktop/stayo-onboarding-sync`, branch `feat/onboarding-profile-sync`. All paths below are relative to it.

## Global Constraints

- **Do not rebuild what exists.** `profile_identity`, `ProfileIdentityService` (including `absorbFromTenancy`, which is written and tested but has zero production callers), `residency-history-service`, `document-vault-service`, and `GET /api/tenants/me/onboarding-prefill` are all live and correct. This plan wires them up.
- **`getContext()`'s payload is additive only.** The `profile` and `tenant` keys keep their exact current shape — `src/portal/pages/ActivateAccountPage.tsx` still reads them and is **frozen legacy** (`apps/frontend/scripts/check-architecture.mjs` enforces an allowlist and fails the build). Never edit anything under `apps/frontend/src/portal/`.
- **`apps/frontend` tests are node-environment only.** No jsdom, no component rendering, matcher is `src/**/*.test.ts` — never `.test.tsx`. Decision logic goes in pure `.ts`; components stay thin renderers.
- **Any new backend test file must be added to `apps/backend/vitest.pure.config.ts`'s explicit `include` allowlist**, or it silently never runs. There is no test database here, so `npm test` cannot run — use `npm run test:pure`.
- **Money is not touched by this plan.** No obligation, payment, or settlement code is in scope.
- **The tenancy row stays the immutable snapshot** of what was true when that stay began. `profile_identity` holds the person's current truth. Never rewrite a `tenants` row to match a later profile edit.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Backend — decide what we already know

**Files:**
- Create: `apps/backend/src/services/tenants/onboarding-known.ts`
- Test: `apps/backend/tests/onboarding-known.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (add the test to `include`)

**Interfaces:**
- Consumes: `IDENTITY_FIELDS` from `apps/backend/src/services/profile/profile-identity-service.ts`.
- Produces: `buildKnown(input): OnboardingKnown` and the types `OnboardingKnown` / `KnownSource`, used by Task 2 and mirrored by Task 4.

This module is **pure** — no Prisma, no imports that reach I/O. That is what lets it run under `test:pure` with no database.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/onboarding-known.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildKnown } from "@/src/services/tenants/onboarding-known";

const identity = (over: Record<string, unknown> = {}) => ({
  date_of_birth: null, gender: null, nationality: null, pan_number: null,
  permanent_address: null, photo_url: null, personal_email: null,
  guardian_name: null, guardian_phone: null, guardian_relation: null,
  profile_type: "STUDENT", college_name: null, roll_number: null, course: null,
  year_of_study: null, branch: null, section: null, office_name: null,
  office_location: null, job_role: null,
  is_complete: false, missing_core_fields: [], completion_percent: 0,
  pending_backfill_fields: [] as string[], has_profile_record: false,
  ...over,
});

describe("buildKnown", () => {
  it("prefers the profile over the invitation for name, email and phone", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "asha@example.com", phone: "+919876543210", mobile_verified: true, phone_verified: false },
      tenant: { phone_1: "9000000000" },
      invitation: { name: "A. Kumar", email: "invited@example.com", phone: "9111111111" },
      identity: identity(),
    });
    expect(known.name).toBe("Asha");
    expect(known.email).toBe("asha@example.com");
    expect(known.phone).toBe("9876543210");
    expect(known.source_of.name).toBe("PROFILE");
  });

  it("falls back to the invitation and marks the source INVITE", () => {
    const known = buildKnown({
      profile: null,
      tenant: {},
      invitation: { name: "A. Kumar", email: "invited@example.com", phone: "9111111111" },
      identity: null,
    });
    expect(known.name).toBe("A. Kumar");
    expect(known.source_of.name).toBe("INVITE");
    expect(known.has_prefill).toBe(false);
  });

  it("treats the phone as verified only when the verified number is the one on offer", () => {
    const verified = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210", mobile_verified: true },
      tenant: {}, invitation: null, identity: identity(),
    });
    expect(verified.phone_verified).toBe(true);

    const stale = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210", mobile_verified: true },
      tenant: { phone_1: "9000000000" }, invitation: null, identity: identity(),
    });
    // The profile's phone still wins, so this stays verified — the mismatch
    // case that matters is a profile with no phone at all.
    expect(stale.phone_verified).toBe(true);

    const noProfilePhone = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: null, mobile_verified: true },
      tenant: { phone_1: "9000000000" }, invitation: null, identity: identity(),
    });
    expect(noProfilePhone.phone).toBe("9000000000");
    expect(noProfilePhone.phone_verified).toBe(false);
  });

  it("marks identity fields read off a tenancy as TENANCY, and the rest PROFILE", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210" },
      tenant: {}, invitation: null,
      identity: identity({
        gender: "Female",
        college_name: "NIT Warangal",
        has_profile_record: true,
        pending_backfill_fields: ["college_name"],
      }),
    });
    expect(known.source_of.gender).toBe("PROFILE");
    expect(known.source_of.college_name).toBe("TENANCY");
    expect(known.identity.gender).toBe("Female");
    expect(known.has_prefill).toBe(true);
  });

  it("does not claim a source for a field that has no value", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210" },
      tenant: {}, invitation: null, identity: identity({ has_profile_record: true }),
    });
    expect(known.source_of.gender).toBeUndefined();
    expect(known.identity.gender).toBeNull();
  });

  it("has prefill when a backfill-sourced field exists even with no profile record", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210" },
      tenant: {}, invitation: null,
      identity: identity({ gender: "Female", pending_backfill_fields: ["gender"], has_profile_record: false }),
    });
    expect(known.has_prefill).toBe(true);
  });
});
```

- [ ] **Step 2: Add the test to the pure allowlist**

In `apps/backend/vitest.pure.config.ts`, inside the `include` array, add after `'tests/profile-identity-service.test.ts',`:

```ts
      'tests/onboarding-known.test.ts',
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/backend && npm run test:pure -- tests/onboarding-known.test.ts
```

Expected: FAIL — cannot resolve `@/src/services/tenants/onboarding-known`.

- [ ] **Step 4: Write the implementation**

Create `apps/backend/src/services/tenants/onboarding-known.ts`:

```ts
import { IDENTITY_FIELDS } from "../profile/profile-identity-service";

/**
 * What onboarding already knows about the person in front of it, and where
 * each fact came from.
 *
 * Deliberately pure — no Prisma, no I/O — so it runs under `test:pure` with no
 * database. `getContext()` supplies the rows; this decides what they mean.
 *
 * The point of `source_of` is that not all prefill is equal. A value the person
 * entered on their own profile deserves to be shown as "we already know this";
 * a value an owner typed into an invite is a guess, and presenting the two with
 * the same confidence is how wrong data gets confirmed by a tired tenant.
 */

export type KnownSource = "PROFILE" | "TENANCY" | "INVITE";

export interface OnboardingKnown {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** True only when the number we are offering is the number we verified. */
  phone_verified: boolean;
  identity: Record<string, unknown>;
  /** Enough here to be worth showing as "we already know this". */
  has_prefill: boolean;
  /** Only fields that actually have a value appear here. */
  source_of: Record<string, KnownSource>;
}

interface ProfileLike {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile_verified?: boolean | null;
  phone_verified?: boolean | null;
}

interface IdentityLike extends Record<string, unknown> {
  pending_backfill_fields?: string[];
  has_profile_record?: boolean;
}

const isBlank = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** Last ten digits — the comparable form of an Indian mobile number. */
const last10 = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(-10);

export function buildKnown(input: {
  profile: ProfileLike | null;
  tenant: Record<string, unknown>;
  invitation: { name?: string | null; email?: string | null; phone?: string | null } | null;
  identity: IdentityLike | null;
}): OnboardingKnown {
  const { profile, tenant, invitation, identity } = input;
  const source_of: Record<string, KnownSource> = {};

  const pick = (field: string, fromProfile: unknown, fromInvite: unknown, fromTenant?: unknown) => {
    if (!isBlank(fromProfile)) {
      source_of[field] = "PROFILE";
      return fromProfile;
    }
    if (!isBlank(fromInvite)) {
      source_of[field] = "INVITE";
      return fromInvite;
    }
    if (!isBlank(fromTenant)) {
      source_of[field] = "TENANCY";
      return fromTenant;
    }
    return null;
  };

  const name = pick("name", profile?.name, invitation?.name) as string | null;
  const email = pick("email", profile?.email, invitation?.email) as string | null;
  const rawPhone = pick("phone", profile?.phone, invitation?.phone, tenant?.phone_1);
  const phone = rawPhone ? last10(rawPhone) : null;

  // Verified means *this* number is verified. A profile flagged verified whose
  // phone column is empty tells us nothing about the tenancy's number.
  const profilePhone = last10(profile?.phone);
  const phone_verified = Boolean(
    (profile?.mobile_verified || profile?.phone_verified) && profilePhone && profilePhone === phone,
  );

  const identityOut: Record<string, unknown> = {};
  const backfilled = new Set(identity?.pending_backfill_fields ?? []);
  for (const field of IDENTITY_FIELDS) {
    const value = identity ? identity[field] : null;
    if (isBlank(value)) {
      identityOut[field] = null;
      continue;
    }
    identityOut[field] = value;
    source_of[field] = backfilled.has(field) ? "TENANCY" : "PROFILE";
  }

  return {
    name,
    email,
    phone,
    phone_verified,
    identity: identityOut,
    has_prefill: Boolean(identity?.has_profile_record) || backfilled.size > 0,
    source_of,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/backend && npm run test:pure -- tests/onboarding-known.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync
git add apps/backend/src/services/tenants/onboarding-known.ts apps/backend/tests/onboarding-known.test.ts apps/backend/vitest.pure.config.ts
git commit -m "$(cat <<'MSG'
feat(onboarding): decide what onboarding already knows, and from where

Pure module, so it runs under test:pure with no database. source_of
exists because a value the person entered themselves and a value an
owner guessed into an invite should not be presented with equal
confidence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Backend — put `known` on the activation context

**Files:**
- Modify: `apps/backend/src/services/tenants/activation-workflow-service.ts` (imports at top; the `return {` block of `getContext()`, currently around line 583)

**Interfaces:**
- Consumes: `buildKnown` from Task 1; the existing `profileIdentityService.getIdentity(profileId)`.
- Produces: a `known: OnboardingKnown` key on the activation context payload, read by Tasks 4 and 5.

Note there is no unit test here — `getContext` is database-bound and this repo has no test database (`DATABASE_URL_TEST` unset, see ADR-043). Task 1 covers the logic; this step is wiring, verified by typecheck and the manual check in Step 4.

- [ ] **Step 1: Add the imports**

At the top of `apps/backend/src/services/tenants/activation-workflow-service.ts`, alongside the existing service imports:

```ts
import { profileIdentityService } from "../profile/profile-identity-service";
import { buildKnown } from "./onboarding-known";
```

- [ ] **Step 2: Load the identity inside `getContext()`**

In `getContext()`, immediately before the final `return {` (the object that starts with `token_status: "VALID",`), add:

```ts
    // The portable profile (phase B). `resolveInvitation()` already gave us the
    // profile, so this needs no session — which is what lets the public,
    // token-authenticated activation route serve prefill at all. Failing soft:
    // a person with no profile row still gets the form, just not pre-filled.
    const identity = profile?.id
      ? await profileIdentityService.getIdentity(profile.id).catch(() => null)
      : null;
```

- [ ] **Step 3: Add the `known` key to the returned object**

In the same `return {` block, directly **after** the closing brace of the existing `profile: { … },` entry and before `tenant: {`, add:

```ts
      /**
       * What we already know about this person, so the form can ask only for
       * what we don't. Additive: `profile` and `tenant` above keep their exact
       * previous shape, because the frozen legacy activation page still reads
       * them.
       */
      known: buildKnown({
        profile,
        tenant,
        invitation,
        identity,
      }),
```

- [ ] **Step 4: Verify it typechecks and the shape is right**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "activation-workflow-service|onboarding-known" || echo "no errors in touched files"
```

Expected: `no errors in touched files`.

- [ ] **Step 5: Commit**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync
git add apps/backend/src/services/tenants/activation-workflow-service.ts
git commit -m "$(cat <<'MSG'
feat(onboarding): serve profile prefill from the activation context

getContext() already resolves the profile from the invite token, so
composing profileIdentityService here needs no session — which is why
this lands on the public token route rather than calling the
session-gated /api/tenants/me/onboarding-prefill from the wizard.

Additive only: profile and tenant keep their shape for the frozen
legacy activation page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Backend — write what the tenant confirms back to their profile

**Files:**
- Modify: `apps/backend/src/services/tenants/activation-workflow-service.ts` — `saveProfile()`, the lines immediately after its `prisma.$transaction(...)` call (currently around line 1215)

**Interfaces:**
- Consumes: `profileIdentityService.absorbFromTenancy(profileId, tenancy)` — already written and already unit-tested in `tests/profile-identity-service.test.ts`; it has had **zero production callers** until now. It drops blank values, so a short form can never wipe a field filled on a longer one.
- Produces: nothing new. This is the task that makes the *second* hostel's onboarding pre-filled.

- [ ] **Step 1: Call `absorbFromTenancy` after the transaction commits**

In `saveProfile()`, between the closing `});` of `await prisma.$transaction(async (tx: any) => { … });` and the `await eventLog.log("profile_completed", …)` line, insert:

```ts
    // Fold what the tenant just confirmed into their portable profile, so the
    // hostel *after* this one opens pre-filled even though this one didn't.
    //
    // Read back rather than reusing the local variables: the transaction above
    // applied `compactObject`, so the row is the authoritative record of what
    // actually landed. `absorbFromTenancy` ignores blanks, so nothing the
    // person filled in on their profile screen gets wiped by a form that
    // simply didn't ask.
    //
    // Deliberately outside the transaction and non-fatal: the tenancy is the
    // record that must be right for this stay, and a failure to update the
    // portable copy must never fail an activation the tenant already completed.
    try {
      const savedTenancy = await prisma.tenants.findUnique({ where: { id: tenant.id } });
      if (savedTenancy) await profileIdentityService.absorbFromTenancy(profile.id, savedTenancy as any);
    } catch (absorbError) {
      console.error("Failed to absorb onboarding profile into profile_identity:", absorbError);
    }
```

- [ ] **Step 2: Drop the Gmail-only rule from `saveAccount()`**

Still in `activation-workflow-service.ts`, replace these lines (currently 1049-1054):

```ts
      throw new Error("VALIDATION_ERROR: Gmail ID is required");
    }
    const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;
    if (!gmailRegex.test(rawEmail)) {
      throw new Error("VALIDATION_ERROR: Please enter a valid Gmail ID (e.g. name@gmail.com)");
    }
```

with:

```ts
      throw new Error("VALIDATION_ERROR: An email address is required");
    }
    // Any real address, not just Gmail. Owners invite people on college and
    // work addresses all the time, and rejecting those made the tenant retype
    // a perfectly valid one — or invent a Gmail account to get past the form.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(rawEmail)) {
      throw new Error("VALIDATION_ERROR: Please enter a valid email address");
    }
```

The frontend half of this same rule is removed in Task 5, Step 4. Both must
land, or the surviving one still blocks the tenant.

- [ ] **Step 3: Verify it typechecks**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "activation-workflow-service" || echo "no errors in touched file"
```

Expected: `no errors in touched file`.

- [ ] **Step 4: Confirm the existing absorb tests still pass**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/backend && npm run test:pure -- tests/profile-identity-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync
git add apps/backend/src/services/tenants/activation-workflow-service.ts
git commit -m "$(cat <<'MSG'
feat(onboarding): fold a completed onboarding back into the portable profile

absorbFromTenancy was written and tested for exactly this and never
called. Without it every onboarding teaches the person's profile
nothing, so a tenant moving to a second hostel retypes everything.

Non-fatal and outside the transaction: the tenancy is what must be
right for this stay, and the portable copy must never fail an
activation the tenant already finished.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Frontend — the pure prefill plan

**Files:**
- Create: `apps/frontend/src/platforms/tenant/onboarding/onboardingPrefill.ts`
- Test: `apps/frontend/src/platforms/tenant/onboarding/onboardingPrefill.test.ts`

**Interfaces:**
- Consumes: the `known` key added in Task 2.
- Produces: `buildPrefillPlan(input): PrefillPlan`, plus the exported types `KnownBlock`, `PrefillPlan`, `KnownRow`. Task 5 renders these and imports nothing else from here.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/platforms/tenant/onboarding/onboardingPrefill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPrefillPlan, type KnownBlock } from './onboardingPrefill';

const known = (over: Partial<KnownBlock> = {}): KnownBlock => ({
  name: 'Asha',
  email: 'asha@example.com',
  phone: '9876543210',
  phone_verified: true,
  has_prefill: true,
  identity: {},
  source_of: {},
  ...over,
});

describe('buildPrefillPlan', () => {
  it('requires no OTP when the phone is verified and untouched', () => {
    const plan = buildPrefillPlan({ known: known(), profileType: 'STUDENT', phoneEdited: false });
    expect(plan.otpRequired).toBe(false);
  });

  it('requires an OTP once the tenant edits the verified phone', () => {
    const plan = buildPrefillPlan({ known: known(), profileType: 'STUDENT', phoneEdited: true });
    expect(plan.otpRequired).toBe(true);
  });

  it('requires an OTP when the phone was never verified', () => {
    const plan = buildPrefillPlan({
      known: known({ phone_verified: false }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(plan.otpRequired).toBe(true);
  });

  it('shows the known block only when there is something to show', () => {
    const empty = buildPrefillPlan({
      known: known({ has_prefill: false, identity: {} }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(empty.showKnownBlock).toBe(false);

    const filled = buildPrefillPlan({
      known: known({ identity: { gender: 'Female', date_of_birth: '2004-03-14' } }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(filled.showKnownBlock).toBe(true);
  });

  it('lists student rows for a student and work rows for a professional', () => {
    const student = buildPrefillPlan({
      known: known({ identity: { college_name: 'NIT Warangal', office_name: 'Acme' } }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    const fields = student.knownRows.map((row) => row.field);
    expect(fields).toContain('college_name');
    expect(fields).not.toContain('office_name');

    const pro = buildPrefillPlan({
      known: known({ identity: { college_name: 'NIT Warangal', office_name: 'Acme' } }),
      profileType: 'WORKING_PROFESSIONAL',
      phoneEdited: false,
    });
    const proFields = pro.knownRows.map((row) => row.field);
    expect(proFields).toContain('office_name');
    expect(proFields).not.toContain('college_name');
  });

  it('omits rows with no value, and labels where each value came from', () => {
    const plan = buildPrefillPlan({
      known: known({
        identity: { gender: 'Female', date_of_birth: null, guardian_name: 'Ramesh' },
        source_of: { gender: 'PROFILE', guardian_name: 'TENANCY' },
      }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    const fields = plan.knownRows.map((row) => row.field);
    expect(fields).toContain('gender');
    expect(fields).not.toContain('date_of_birth');
    expect(plan.knownRows.find((row) => row.field === 'gender')?.origin).toBe('PROFILE');
    expect(plan.knownRows.find((row) => row.field === 'guardian_name')?.origin).toBe('TENANCY');
  });

  it('degrades to a plain form when there is no known block at all', () => {
    const plan = buildPrefillPlan({ known: undefined, profileType: 'STUDENT', phoneEdited: false });
    expect(plan.showKnownBlock).toBe(false);
    expect(plan.otpRequired).toBe(true);
    expect(plan.account.name).toBe('');
    expect(plan.knownRows).toEqual([]);
  });

  it('formats a date of birth for reading, not for an input', () => {
    const plan = buildPrefillPlan({
      known: known({ identity: { date_of_birth: '2004-03-14T00:00:00.000Z' } }),
      profileType: 'STUDENT',
      phoneEdited: false,
    });
    expect(plan.knownRows.find((row) => row.field === 'date_of_birth')?.display).toBe('14 Mar 2004');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/frontend && npx vitest run src/platforms/tenant/onboarding/onboardingPrefill.test.ts
```

Expected: FAIL — cannot resolve `./onboardingPrefill`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/platforms/tenant/onboarding/onboardingPrefill.ts`:

```ts
/**
 * Which onboarding fields are already known, and which still have to be asked.
 *
 * Pure and node-testable on purpose: `apps/frontend`'s suite has no jsdom, so
 * every decision lives here and `WelcomeIdentityStep` stays a renderer over the
 * result. Nothing in this file touches React.
 */

export type KnownSource = 'PROFILE' | 'TENANCY' | 'INVITE';

/** The `known` block on the activation context (see `onboarding-known.ts`). */
export interface KnownBlock {
  name: string | null;
  email: string | null;
  phone: string | null;
  phone_verified: boolean;
  identity: Record<string, unknown>;
  has_prefill: boolean;
  source_of: Record<string, KnownSource>;
}

export interface KnownRow {
  field: string;
  label: string;
  /** Ready to render — dates are humanised, everything else is its string form. */
  display: string;
  origin: KnownSource;
}

export interface PrefillPlan {
  /** The locked "your Stayo account" block. */
  account: { name: string; email: string; phone: string; phoneVerified: boolean };
  /** The "we already know these" rows, in reading order. */
  knownRows: KnownRow[];
  /** False when there is nothing worth showing — render the plain form instead. */
  showKnownBlock: boolean;
  /** True when submit must carry a fresh OTP. */
  otpRequired: boolean;
}

const PERSONAL_ROWS: { field: string; label: string }[] = [
  { field: 'date_of_birth', label: 'Date of birth' },
  { field: 'gender', label: 'Gender' },
  { field: 'permanent_address', label: 'Permanent address' },
  { field: 'guardian_name', label: 'Guardian' },
  { field: 'guardian_phone', label: 'Guardian mobile' },
  { field: 'guardian_relation', label: 'Relationship' },
];

const ACADEMIC_ROWS: { field: string; label: string }[] = [
  { field: 'college_name', label: 'College' },
  { field: 'course', label: 'Course' },
  { field: 'year_of_study', label: 'Year of study' },
  { field: 'branch', label: 'Branch' },
  { field: 'roll_number', label: 'Roll number' },
];

const PROFESSIONAL_ROWS: { field: string; label: string }[] = [
  { field: 'office_name', label: 'Company' },
  { field: 'job_role', label: 'Role' },
  { field: 'office_location', label: 'Office location' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates arrive as ISO strings; a person reads "14 Mar 2004". */
function display(field: string, value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (field !== 'date_of_birth') return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

export function buildPrefillPlan(input: {
  known?: KnownBlock;
  profileType: 'STUDENT' | 'WORKING_PROFESSIONAL';
  /** Has the tenant unlocked and changed the mobile number in this session? */
  phoneEdited: boolean;
}): PrefillPlan {
  const { known, profileType, phoneEdited } = input;

  const account = {
    name: known?.name ?? '',
    email: known?.email ?? '',
    phone: known?.phone ?? '',
    phoneVerified: Boolean(known?.phone_verified),
  };

  // The server applies exactly this rule in `saveAccount()`. Asking for an OTP
  // the server would not have demanded is the bug this replaces.
  const otpRequired = !account.phoneVerified || phoneEdited;

  const specs = [
    ...PERSONAL_ROWS,
    ...(profileType === 'WORKING_PROFESSIONAL' ? PROFESSIONAL_ROWS : ACADEMIC_ROWS),
  ];

  const knownRows: KnownRow[] = known
    ? specs
        .map((spec) => ({
          field: spec.field,
          label: spec.label,
          display: display(spec.field, known.identity?.[spec.field]),
          origin: known.source_of?.[spec.field] ?? 'PROFILE',
        }))
        .filter((row) => row.display !== '')
    : [];

  return {
    account,
    knownRows,
    showKnownBlock: knownRows.length > 0,
    otpRequired,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/frontend && npx vitest run src/platforms/tenant/onboarding/onboardingPrefill.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync
git add apps/frontend/src/platforms/tenant/onboarding/onboardingPrefill.ts apps/frontend/src/platforms/tenant/onboarding/onboardingPrefill.test.ts
git commit -m "$(cat <<'MSG'
feat(onboarding): pure plan for which identity fields to lock, prefill or ask

All the decisions live here so the step component stays a renderer —
apps/frontend has no jsdom, so logic in a .ts file is the only logic
that can actually be tested.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Frontend — render the three tiers and stop demanding a needless OTP

**Files:**
- Modify: `apps/frontend/src/platforms/tenant/onboarding/activationTypes.ts` (add `known` to `ActivationContext`)
- Modify: `apps/frontend/src/platforms/tenant/onboarding/steps/WelcomeIdentityStep.tsx`
- Modify: `apps/frontend/src/platforms/tenant/onboarding/ActivationPage.tsx`
- Do **not** touch: `apps/frontend/src/portal/pages/ActivateAccountPage.tsx` (frozen)

**Interfaces:**
- Consumes: `buildPrefillPlan`, `KnownBlock`, `PrefillPlan` from Task 4; the `known` context key from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Type the new context key**

In `apps/frontend/src/platforms/tenant/onboarding/activationTypes.ts`, add the import at the top:

```ts
import type { KnownBlock } from './onboardingPrefill';
```

and inside the `ActivationContext` type, directly after the `profile: { name?: string; email?: string; phone?: string };` line:

```ts
  /** What Stayo already knows about this person (see `onboarding-known.ts`). */
  known?: KnownBlock;
```

- [ ] **Step 2: Track whether the tenant unlocked the phone**

In `ActivationPage.tsx`, next to the other `useState` declarations (near `const [accountOtpError, setAccountOtpError] = useState('');`), add:

```ts
  /** The tenant tapped "Change" on the verified mobile — a fresh OTP is now due. */
  const [phoneEdited, setPhoneEdited] = useState(false);
```

- [ ] **Step 3: Seed the account fields from `known`**

In `loadContext()`, replace the existing `setAccount((prev) => ({ … }));` call with:

```ts
      setAccount((prev) => ({
        ...prev,
        // `known` is the person; `tenant`/`profile` is the tenancy snapshot the
        // owner typed. Prefer the person.
        phone: prev.phone || phoneDigits(data.known?.phone || data.tenant?.phone_1 || data.profile?.phone),
        email: prev.email || String(data.known?.email || data.profile?.email || ''),
      }));
```

- [ ] **Step 4: Drop the frontend's Gmail-only rule**

In `ActivationPage.tsx`'s `submitAccount()`, replace:

```ts
    if (!emailVal) {
      setError('Gmail ID is required');
      return false;
    }
    if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(emailVal)) {
      setError('Please enter a valid Gmail ID (e.g. name@gmail.com)');
      return false;
    }
```

with:

```ts
    if (!emailVal) {
      setError('An email address is required');
      return false;
    }
    // Any real address, not just Gmail: the owner may well have invited this
    // person on a college or work address, and rejecting it made them retype a
    // perfectly good one.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal)) {
      setError('Please enter a valid email address');
      return false;
    }
```

- [ ] **Step 5: Pass the plan into the step**

Still in `ActivationPage.tsx`, add near the other derived values (just after `const isStudent = …`):

```ts
  const prefillPlan = buildPrefillPlan({
    known: ctx?.known,
    profileType: isStudent ? 'STUDENT' : 'WORKING_PROFESSIONAL',
    phoneEdited,
  });
```

and add the import at the top:

```ts
import { buildPrefillPlan } from './onboardingPrefill';
```

Then, in the `<WelcomeIdentityStep … />` JSX, add these props:

```tsx
          prefill={prefillPlan}
          onUnlockPhone={() => setPhoneEdited(true)}
```

- [ ] **Step 6: Accept the new props in the step**

In `WelcomeIdentityStep.tsx`, add to the top imports:

```tsx
import type { PrefillPlan } from '../onboardingPrefill';
```

and to `WelcomeIdentityStepProps`:

```tsx
  /** What we already know — see `onboardingPrefill.ts`. */
  prefill: PrefillPlan;
  /** Tenant tapped "Change" on the verified mobile; a fresh OTP is now due. */
  onUnlockPhone: () => void;
```

Add `prefill` and `onUnlockPhone` to the destructured parameter list of `export function WelcomeIdentityStep({ … })`.

- [ ] **Step 7: Replace the unconditional OTP gate**

In `renderIdentity`, replace:

```tsx
    const canSubmit = showAccountFields ? otpSent && account.otp.length === 6 : true;
```

with:

```tsx
    // Only demand a code when the server actually would — an already-verified
    // number that the tenant has not touched needs nothing. `saveAccount()`
    // applies the same rule; the old unconditional gate was stricter than the
    // server for no reason.
    const canSubmit = showAccountFields && prefill.otpRequired ? otpSent && account.otp.length === 6 : true;
```

- [ ] **Step 8: Render the locked account block**

In `renderIdentity`, inside `{showAccountFields && ( <> … </> )}`, replace the whole existing "Primary Mobile" `<div className="mt-4">…</div>` and the "Gmail ID" `<div className="mt-3.5">…</div>` with:

```tsx
            <div className="mt-4 rounded-[13px] p-[14px_13px]" style={{ background: '#F6F1EA' }}>
              <div className="text-[11px] font-extrabold uppercase" style={{ color: '#7A6F63', letterSpacing: '.05em' }}>
                Your Stayo account
              </div>

              {prefill.account.name && (
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-semibold" style={{ color: '#8A7F75' }}>Full name</span>
                  <span className="text-[12.5px] font-bold" style={{ color: '#2A2521' }}>{prefill.account.name}</span>
                </div>
              )}

              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-semibold" style={{ color: '#8A7F75' }}>Mobile</span>
                  {prefill.account.phoneVerified && !prefill.otpRequired && (
                    <button type="button" onClick={onUnlockPhone} className="text-[11px] font-bold" style={{ color: '#B46A55' }}>
                      Change
                    </button>
                  )}
                </div>
                <PhoneField
                  value={account.phone}
                  onChange={(v) => setAccount({ ...account, phone: v })}
                  placeholder="10-digit mobile number"
                  verified={prefill.account.phoneVerified && !prefill.otpRequired}
                  disabled={prefill.account.phoneVerified && !prefill.otpRequired}
                  onSend={onSendOtp}
                  sending={otpSending}
                  countdown={otpCountdown}
                  sent={otpSent}
                />
                {prefill.otpRequired && account.phone.length > 0 && account.phone.length < 10 && (
                  <div className="mt-1.5 text-[11.5px] font-medium" style={{ color: '#8A7F75' }}>
                    {10 - account.phone.length} more digit{10 - account.phone.length === 1 ? '' : 's'} to verify
                  </div>
                )}
                {prefill.otpRequired && otpSent && (
                  <OtpBlock
                    phone={account.phone}
                    otp={account.otp}
                    setOtp={(v) => setAccount({ ...account, otp: v })}
                    onResend={onSendOtp}
                    sending={otpSending}
                    countdown={otpCountdown}
                    helperText="We sent a verification code to your mobile number."
                    error={otpError}
                  />
                )}
              </div>

              <div className="mt-3">
                <div className="mb-1.5 text-[11.5px] font-semibold" style={{ color: '#8A7F75' }}>Email</div>
                <div style={{ ...cardWrap, padding: '0 13px' }}>
                  <input
                    type="email"
                    value={account.email}
                    onChange={(e) => setAccount({ ...account, email: e.target.value.trim() })}
                    placeholder="you@example.com"
                    className="text-sm font-medium"
                    style={inputBase}
                  />
                </div>
                <div className="mt-1.5 text-[11px]" style={{ color: '#9A8F84' }}>
                  From your Stayo account. Used for notifications and hostel communications.
                </div>
              </div>
            </div>
```

Note the email row carries **no Verified tick** — this system has no email verification, and a tick would claim something never checked.

- [ ] **Step 9: Render the "we already know these" block**

In `renderIdentity`, immediately after the closing `)}` of the `{showAccountFields && (…)}` block and before the `<div className="mt-4 flex flex-col gap-3.5">` that holds Gender/DOB/Guardian, add:

```tsx
        {prefill.showKnownBlock && (
          <div className="mt-4 rounded-[13px] p-[14px_13px]" style={{ background: '#F6F1EA' }}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5" style={{ color: '#1F7A52' }} strokeWidth={2.6} />
              <span className="text-[11px] font-extrabold uppercase" style={{ color: '#7A6F63', letterSpacing: '.05em' }}>
                We already know these
              </span>
            </div>
            <div className="mt-2.5 flex flex-col gap-2">
              {prefill.knownRows.map((row) => (
                <div key={row.field} className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-semibold" style={{ color: '#8A7F75' }}>{row.label}</span>
                  <span className="text-[12.5px] font-bold" style={{ color: '#2A2521' }}>{row.display}</span>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-[11px] leading-relaxed" style={{ color: '#9A8F84' }}>
              From your Stayo profile. Anything below can still be edited.
            </div>
          </div>
        )}
```

The editable fields below it stay exactly as they are — they are already seeded from the merged profile, so this block *explains* the prefill rather than replacing the inputs.

- [ ] **Step 10: Run the frontend checks**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/frontend && npm run check:architecture && npx tsc --noEmit && npx vitest run
```

Expected: architecture check passes (nothing under `src/portal` changed, no raw `fetch`/`axios` added), typecheck clean, all tests pass.

- [ ] **Step 11: Commit**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync
git add apps/frontend/src/platforms/tenant/onboarding/
git commit -m "$(cat <<'MSG'
feat(onboarding): show what we already know instead of asking again

Three tiers on the Identity screen: the locked Stayo account block,
the pre-filled "we already know these" block, and the fields genuinely
new to this hostel.

Also removes two things that were wrong rather than merely verbose: an
OTP gate stricter than the server's own rule, and a Gmail-only regex
that rejected the college and work addresses owners actually invite
people on. Email carries no Verified tick — nothing in this system
verifies email.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/obsidian/Features.md`, `docs/obsidian/APIs.md`, `docs/obsidian/Business-Rules.md`, `docs/obsidian/Decisions.md`, `docs/obsidian/Changelog.md`

Per `CLAUDE.md` this is not follow-up work — a change of this shape that ships without the vault update is incomplete.

- [ ] **Step 1: Read the current shape of each page before editing**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/docs/obsidian && tail -30 Changelog.md && grep -n "ADR-0" Decisions.md | tail -5
```

Match the existing heading style and ADR numbering; take the next free ADR number.

- [ ] **Step 2: Write the entries**

- **`Features.md`** — under tenant onboarding: onboarding now opens pre-filled from the portable profile; the Identity screen has three tiers; completing an onboarding writes back to `profile_identity` so the next hostel is pre-filled. Link `[[Business-Rules]]` and `[[APIs]]`.
- **`APIs.md`** — `GET /api/tenants/activate/context` gains an additive `known` key: `{ name, email, phone, phone_verified, identity, has_prefill, source_of }`. Note it is served on the **public token route** with no session, and that `GET /api/tenants/me/onboarding-prefill` remains for the logged-in preview case, now reading the same service.
- **`Business-Rules.md`** — two rules. (1) The `tenants` row is the immutable snapshot of what was true when a stay began; `profile_identity` is the person's current truth; onboarding writes both. (2) A phone OTP is required during activation only when the number is unverified or the tenant changed it — stated once, applied by both `saveAccount()` and `buildPrefillPlan`.
- **`Decisions.md`** — one ADR: verified account fields are locked with a re-verifying "Change"; email is shown as "from your Stayo account" **without** a Verified tick, because no email verification exists in this system (`profile` has `phone_verified`/`mobile_verified` but no `email_verified`; `auth-otp-service.ts` is phone-only; the only email-verified signal is a Supabase JWT claim present solely for Google sign-in). Record that the Gmail-only regex was dropped as part of this.
- **`Changelog.md`** — one dated entry linking the above.

- [ ] **Step 3: Commit**

```bash
cd /home/sp/Desktop/stayo-onboarding-sync
git add docs/obsidian/
git commit -m "$(cat <<'MSG'
docs: record the onboarding/profile sync in the vault

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Known deviation from the spec

The spec's section E asks for an automated backend test that activates at
hostel A, moves the tenant out, invites them to hostel B and asserts the
context comes back pre-filled. **That test is not in this plan**, because
`apps/backend` has no test database — `DATABASE_URL_TEST` is unset, `npm test`
cannot run at all here, and `test:pure` is explicitly for modules that touch no
I/O (ADR-043). The logic it would have covered is unit-tested in Tasks 1 and 4;
the database round-trip is covered only by the manual check below. Do not
report that requirement as met.

## Verification before calling this done

```bash
cd /home/sp/Desktop/stayo-onboarding-sync/apps/backend && npm run test:pure && npm run check:invariants
cd /home/sp/Desktop/stayo-onboarding-sync/apps/frontend && npm run build
```

`npm test` in `apps/backend` cannot run here — there is no test database (ADR-043). Say so plainly rather than reporting a pass that did not happen.

**Manual check that proves the feature**, once a dev server is up: invite a tenant whose profile already has identity fields, open the activation link, and confirm the Identity screen shows the locked account block with no OTP prompt and the "we already know these" rows. Then complete it, move the tenant out, invite the same profile to a second hostel, and confirm the second activation opens pre-filled — that last step is the whole point and is not covered by any automated test in this repo.
