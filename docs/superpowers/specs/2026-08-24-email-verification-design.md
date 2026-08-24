# Email verification (tenant) — Design

**Date:** 2026-08-24
**Status:** **Parked.** Designed, deliberately not scheduled — see §2.1.
**Scope:** tenant accounts only. Owner signup is deliberately untouched — see §8.
**Related:** [[Decisions]] ADR-078, ADR-096, ADR-031, ADR-035
**Sequenced after:** the enquiry phone gate (shipped 2026-08-24, see [[Bugs]]) and the
profile↔onboarding sync. Neither depends on this.

## 1. The hole

Signup takes an email that nobody proves, and then tells the auth layer it *was* proved.

Every account is created through `supabase.auth.admin.createUser({ email_confirm: true })`
([`lib/auth/supabase-identity.ts:67`](../../../apps/backend/lib/auth/supabase-identity.ts),
[`lib/services/auth-service.ts:621`](../../../apps/backend/lib/services/auth-service.ts)). That
flag marks the address confirmed **without sending anything**. Combined with a signup form that
accepts any syntactically valid address, the result is:

> Anyone can create a Stayo account on an email address they do not control.

That address is the login identifier and the password-reset target. So the squatted account is not
inert — it occupies the victim's address permanently, because `profiles.email` is `@unique`. When
the real owner of that address tries to sign up, they are told the account already exists.

Verified against the schema: `model profile` has `mobile_verified` and `phone_verified` and **no
email equivalent**. There is no email OTP, no confirmation link, and no verification token anywhere
in `apps/backend`.

**One exception:** Google sign-in. That address comes from Google, which verified it. Those
accounts are genuinely fine and must not be asked to prove anything again.

## 2. Why this is *not* a signup step

An earlier draft of this design put the OTP **inside** signup, blocking account creation. That was
wrong, for a reason worth recording so it is not re-proposed.

### 2.1 Email verification buys nothing for the thing Stayo actually runs on

Stayo's funnel is: seeker signs up → seeker enquires → **owner calls back**. The lead that reaches
the owner carries `student_name`, `student_email` and `student_phone`, and the owner's next action
is to phone or WhatsApp. The email's only role in that entire chain is as a *fallback* delivery
channel for the invitation, used solely when WhatsApp fails
([`tenant-invitation-lifecycle-service.ts:106`](../../../apps/backend/src/services/tenants/tenant-invitation-lifecycle-service.ts)).

So a verified email does **not** improve lead quality. A verified *phone* does. Putting a blocking
OTP at signup would tax the mouth of the Discovery funnel to buy something the funnel does not use.

**The real defence of lead quality was a different fix entirely** — enforcing a phone on
`createEnquiry` server-side, which shipped on 2026-08-24 (see [[Bugs]]). That closed the gap where
a lead could reach an owner's inbox uncallable. This spec should never have been sequenced ahead
of it.

### 2.2 What email verification *is* still worth

Exactly one thing: the squatting hole in §1. That is a genuine security defect and worth closing —
just not at the price of a blocking step at signup. Hence §7's non-blocking shape: the account is
created and usable immediately, and `email_verified` flips whenever the person gets around to it.

The phone rule is unchanged by this design. It is verified at enquiry time (ADR-078/096), and now
enforced server-side there.

## 3. Trust semantics: `email_verified` is a fact, not a gate

This is the load-bearing decision, and it constrains everything below.

- **Login is unchanged.** An unverified email still signs in, exactly as today.
- **Nothing is blocked** by `email_verified` on day one.
- The column records *what happened at signup*, so later work can consult it.

**Why not gate immediately:** every existing account defaults to `false`. A login gate would lock
out the entire current user base the moment it deployed. Turning the fact into a gate is a separate
decision, needing its own ADR and a backfill plan behind it.

## 4. Degradation is a requirement, not a nicety

**A failure to *send* an email must not block signup.** Under §7 this is structural rather than a
policy choice — the send happens after the account exists, so there is nothing left to block. The
`SKIPPED` row still matters for the audit trail.

The precedent is [`phone-verification-mode.ts`](../../../apps/backend/lib/services/auth/phone-verification-mode.ts)
and its spec `2026-07-31-whatsapp-unavailable-signup-fallback-design.md`: when WhatsApp is
unconfigured or its breaker is open, signup writes a `SKIPPED` row and proceeds with
`phone_verified: false`, rather than blocking behind a code nobody can receive.

Email adopts the same posture. `EmailService.sendEmail` already returns `{ sent: false, error }`
when `RESEND_API_KEY` is missing ([`email-service.ts:71`](../../../apps/backend/lib/services/email-service.ts)),
which maps directly onto a `SKIPPED` row.

**The honest tradeoff:** squatting is mitigated by notification, not prevented (§7). This design
accepts that, because the alternative — a mail-provider outage becoming "nobody can create an
account" — is worse for a product whose growth depends on signups. A `SKIPPED` row records *why*
an address is unverified, so the audit trail distinguishes "we could not check" from "we did not
try."

## 5. Data model

### 5.1 `profiles.email_verified`

```prisma
email_verified  Boolean  @default(false)
```

**Migration ordering is mandatory: migrate before deploy.** Per the 2026-08-22 production outage,
Prisma requests every declared scalar column on any read that passes no explicit `select`, so
declaring this field and deploying ahead of its migration 500s every unselected `profile` read.
`profiles` has many such reads. There is no safe deploy-first path here.

### 5.2 `email_verification_otps` (new table)

Mirrors [`PhoneVerificationOtp`](../../../apps/backend/prisma/schema.prisma) column for column,
with `email` in place of `phone`:

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `email` | String | normalized lowercase |
| `otp_hash` | String | bcrypt, same as phone |
| `purpose` | String | `EMAIL_VERIFICATION` |
| `status` | String | `PENDING` / `VERIFIED` / `SKIPPED` / `EXPIRED` |
| `attempts` / `max_attempts` | Int | same caps as phone (5) |
| `expires_at` | Timestamptz | same TTL as phone |
| `verified_at` | Timestamptz? | freshness anchor for the gate |
| `provider_message_id` | String? | Resend id |
| `provider_status` | String? | |
| `failure_reason` | String? | |
| `request_ip` | String? | |
| `created_at` | Timestamptz | |

Indexes: `email`, `expires_at`, `status`, `(request_ip, created_at)` — matching the phone table.

**Why a separate table rather than adding a `channel` column to `phone_verification_otps`:** that
table is read directly by the guardian-verification path in `activation-workflow-service.saveProfile`
and by `signup-phone-verification-gate`, both of which query by phone and assume every row is a
phone row. Widening it makes those queries able to return email rows — a change to code that is not
part of this work. A parallel table is purely additive. The cost is roughly forty lines of
near-duplicate service code; that is the cheaper mistake.

## 6. Services and routes

### 6.1 `AuthEmailOtpService`

Mirrors `AuthOtpService`:

- `sendEmailOtp({ email, purpose, requestIp })` — generates a 6-digit code, bcrypt-hashes it,
  writes `PENDING`, sends via `EmailService`. On send failure or missing `RESEND_API_KEY`, writes
  `SKIPPED` (§4) and returns `verification_required: false` with a reason.
- `verifyEmailOtp({ email, otp, purpose, requestIp })` — same attempt cap, same expiry check, same
  `PENDING`-only matching rule as the phone service. Marks `VERIFIED`.

Reuses the existing rate limiter. Per-email **and** per-IP limits, since an unauthenticated
endpoint that sends mail is a spam vector in a way `send-phone-otp` already had to solve.

### 6.2 No signup gate

An earlier draft specified a `resolveSignupEmailVerification` mirroring
[`signup-phone-verification-gate.ts`](../../../apps/backend/lib/services/auth/signup-phone-verification-gate.ts).
**That is deliberately not built**, because nothing blocks on it (§7): a gate whose failure mode is
"proceed anyway" is not a gate, it is a lookup with extra steps.

`verifyEmailOtp` writes `profiles.email_verified` directly. Any future consumer that wants to *act*
on the flag reads the column, not a freshness window — the 30-minute `SIGNUP_OTP_FRESHNESS_MS`
concept exists to bind a verification to a signup attempt in flight, and there is no such binding
here.

If this design is ever changed back to blocking (§2.1), the gate comes back with it.

### 6.3 Routes

- `POST /api/auth/send-email-otp` — mirrors `send-phone-otp`'s shape, including the
  `verification_required` / `reason` response fields.
- `POST /api/auth/verify-email-otp` — mirrors `verify-phone-otp`.

## 7. Flow — non-blocking, after the account exists

**Signup itself is completely unchanged.** No new step, no new field, no added latency. The person
is signed in and browsing at exactly the speed they are today.

1. `POST /api/auth/tenant-signup` succeeds as it does now and creates the account with
   `email_verified: false`.
2. **After** the response is committed, a verification code is dispatched to the address. Failure
   here is logged and otherwise ignored — it must never surface as a signup error, because signup
   already succeeded.
3. The code is redeemable at `POST /api/auth/verify-email-otp` from wherever the person happens to
   be. Nothing in the product is withheld until they do.
4. On success, `profiles.email_verified` flips to `true`.

**Where the prompt to verify lives is deliberately left open.** A banner in the tenant app, a
prompt at the moment the address is first *used* for something that matters (password reset,
invitation delivery), or nothing at all until then — all are compatible with this design and none
of them are decided here. Deciding it needs product judgement about a surface that does not exist
yet.

**Google path:** untouched, and born `email_verified: true` — a one-line addition in
`lib/auth/supabase-provision.ts`. Google already verified the address; asking again would be pure
friction and would make ADR-096's "two ways in, neither privileged" promise false.

**Degraded path:** Resend unconfigured or failing → `SKIPPED` row → nothing happens to the user at
all. This is strictly less user-visible than in the blocking design, which is the point.

**Consequence to be explicit about:** because nothing blocks, a squatter still *obtains* the
account. What changes is that the address's real owner receives a message telling them an account
was created — which is the standard mitigation for this class of hole, and is a notification
remedy rather than a prevention one. If prevention is required, that is a blocking design and a
different spec.

## 8. Explicitly out of scope

- **Owner signup.** `/api/auth/owner-signup` has the identical hole and is knowingly left open for
  now. Since §7 hangs verification off account creation rather than off the signup route, extending
  it to owners is a matter of dispatching the same code from a second place. This is a deliberate
  scope decision, not an oversight — it should not be recorded as "done" anywhere.
- **Gating login on `email_verified`** (§3).
- **Changing `email_confirm: true`** in the Supabase admin calls. Verification lives in our
  `profiles` table, where onboarding can read it; splitting it across Supabase's `auth.users` would
  give the product two verification stories in two systems.
- **Re-verifying existing accounts.** They default to `false` and stay there. Google-provisioned
  accounts may be backfilled to `true` since that fact is already known. No forced re-verification
  at login — that generates support load and, during a Resend incident, an outage.
- **The activation/onboarding 400** that motivated this thread. That is project 1 and is caused by
  a dropped profile link, not by unverified email. It is unblocked by this work but not fixed by it.

## 9. Testing

`apps/backend` tests run via `npm run test:pure`, whose `vitest.pure.config.ts` uses an **explicit
include allowlist** — a new test file silently never runs unless it is added there. Every file
below must be added to that list.

| Test | Asserts |
|---|---|
| `email-otp-service.test.ts` | code hashing, expiry, attempt cap, `PENDING`-only matching |
| `signup-email-verification-gate.test.ts` | freshness window, `VERIFIED` vs `SKIPPED`, stale rejection — mirrors the existing phone-gate test |
| `email-verification-degrade.test.ts` | missing `RESEND_API_KEY` → `SKIPPED` row → signup succeeds with `email_verified: false` |
| `tenant-signup-unblocked.test.ts` | signup succeeds and returns a session even when the dispatch throws; Google path born `email_verified: true` |
| `tenantSignupForm.test.ts` (extend) | the new OTP step's pure field rules |

## 10. Invariants this must not break

1. **A Resend outage never blocks signup** (§4).
2. **Google accounts are never asked to verify an email** and are born `email_verified: true`.
3. **Login behaviour is unchanged** for every existing account (§3).
4. **`phone_verification_otps` and its readers are untouched** — no shared-table widening (§5.2).
5. **The migration lands before the deploy** that declares the Prisma field (§5.1).
6. **Signup latency and failure modes are unchanged.** No new blocking call sits between the person
   pressing Create account and getting a session; a dispatch failure is invisible to them (§7).
7. **`email_verified` is only ever written by a real verification** — never inferred from a send,
   an open, or the mere existence of the address.
