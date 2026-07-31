# Signup phone verification: graceful fallback when WhatsApp is unavailable

**Date:** 2026-07-31
**Status:** Approved (design)
**Scope:** Owner signup path only — the lead-capture modal and the owner onboarding wizard's account step. Not the tenant portal, not reminders, not login.

## Problem

StayO's WhatsApp Business setup is not finished — no Meta credentials, no approved OTP
template. Every owner-acquisition entry point nevertheless routes through a phone-OTP gate:

```
HostelLeadModal / OwnerOnboardingWizard
  → POST /api/auth/send-phone-otp
  → notificationService.sendOtp()
  → MetaWhatsAppProvider.sendOtp()      ← throws: no credentials
```

Consequences today:

- In production this returns `502 OTP_SEND_FAILED`. Signup is impossible.
- In development, `AuthOtpService.sendPhoneOtp` has two workarounds that hide this rather
  than handle it: it writes the plaintext code to `apps/backend/latest-otp.txt`
  (`auth-otp-service.ts:65-69`), and it swallows any send error whenever
  `NODE_ENV !== "production"`, returning `success: true` with nothing actually sent
  (`auth-otp-service.ts:112-125`). The user still faces a six-digit OTP screen whose code
  exists only in a file on disk — the state visible in the reported screenshot.

Both downstream gates then require a real verification to have happened:

- `POST /api/leads/self-serve` (`route.ts:34-41`) — requires a `VERIFIED`
  `phone_verification_otps` row for purpose `LEAD_CAPTURE` within 30 minutes.
- `POST /api/auth/owner-signup` (`route.ts:44-53`) — the same check for purpose
  `PHONE_VERIFICATION`.

## Goal

When WhatsApp cannot deliver, signup proceeds without an OTP step and records the phone as
**unverified**. When WhatsApp is live, verification is enforced exactly as it is today, with
no code change — only configuration.

## Non-goals

- No retroactive verification of accounts or leads created while degraded.
- No login-time verification prompt, dashboard nag banner, or step-up gate on unverified
  users. (Explicitly de-scoped: this change is about the signup page.)
- No email/SMS OTP fallback channel. The fallback is *skip*, not *another channel*.
- `POST /api/auth/verify-phone-otp` is unchanged; in degraded mode the frontend never
  calls it.

## Design

### 1. Mode resolver

New module `apps/backend/lib/services/auth/phone-verification-mode.ts`.

```ts
export type PhoneVerificationMode = "on" | "off";
export function resolvePhoneVerificationMode(): PhoneVerificationMode;
```

Resolution order:

1. `PHONE_VERIFICATION_MODE` env var, when set to `on` or `off` — wins outright. Lets an
   operator kill verification during a Meta outage, or force it on to test the real path.
   Any other value is ignored (and logged once at startup) rather than throwing.
2. Otherwise derived from configuration: `on` only when **all** of `OTP_PROVIDER=whatsapp`,
   `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`/`PHONE_NUMBER_ID`,
   and `WHATSAPP_OTP_TEMPLATE` are present. Otherwise `off`.

The same four variables are already the ones `validateWhatsAppConfiguration()` checks
(`meta-provider.ts:42-63`); the resolver reuses that list so the two cannot drift.

Resolution is pure and per-call (env is stable within a process), so no caching is needed.

### 2. Circuit breaker

Same module. Guards against a configured-but-broken provider — expired token, Meta outage —
where every send burns a 10-second timeout (`DEFAULT_TIMEOUT_MS`) before failing.

```ts
export async function isOtpBreakerOpen(): Promise<boolean>;
export async function recordOtpSendFailure(reason: string): Promise<void>;
export async function recordOtpSendSuccess(): Promise<void>;
```

- State in Redis under a new `redisKeys.otpProviderBreaker()` key, following the existing
  optional-Redis contract: if Redis is unavailable, fall back to a module-level in-process
  counter. Redis is an accelerator here, never a correctness dependency.
- **Closed → Open:** 3 failures within a 10-minute window.
- **Open:** 15-minute cooldown. Sends are skipped without a network call.
- **Open → Half-open:** after cooldown, the next request performs one trial send. Success
  closes the breaker and clears the counter; failure re-opens it for another cooldown.
- Any success while closed resets the failure count.

Thresholds are module constants, not env vars — no evidence yet that they need tuning.

### 3. Degraded send path

`AuthOtpService.sendPhoneOtp` gains a skip path, scoped to
`SKIPPABLE_PURPOSES = ["PHONE_VERIFICATION", "LEAD_CAPTURE"]` — the two signup purposes.
Any other purpose keeps today's behaviour, including the hard 502.

Order of operations (rate limits are enforced first, unchanged — the skip path must not
become an unthrottled way to spray rows into the table):

1. `resolvePhoneVerificationMode() === "off"` → **skip**, reason `PROVIDER_NOT_CONFIGURED`.
2. `isOtpBreakerOpen()` → **skip**, reason `PROVIDER_UNAVAILABLE`. No network call.
3. Otherwise attempt the send as today.
   - Success → `recordOtpSendSuccess()`, respond as today with `verification_required: true`.
   - Failure → `recordOtpSendFailure()`, then **skip this same request**, reason
     `PROVIDER_SEND_FAILED`. The user whose request trips the breaker must not be the one
     who eats the error.

A skip writes a `phone_verification_otps` row so the downstream gates and the audit trail
still have something to point at:

| Column | Value |
|---|---|
| `status` | `SKIPPED` (new value; the column is a plain string, not a Prisma enum) |
| `otp_hash` | hash of a random value that is never sent, so the row can never be verified |
| `provider_status` | `UNAVAILABLE` |
| `verified_at` | now — the row is immediately "spent", not pending |
| `failure_reason` | `whatsapp_unavailable:<reason>` |
| `expires_at` | now + 5 min, as usual |

Setting `verified_at` matters: the freshness windows downstream are computed from it.

Response shape gains one field, additive and backward-compatible:

```jsonc
// verification actually sent
{ "success": true, "expires_in_seconds": 300, "verification_required": true }
// degraded
{ "success": true, "verification_required": false, "reason": "PROVIDER_NOT_CONFIGURED" }
```

A `logger.metrics("otp.request.skipped", { phone: masked, purpose, reason })` line is
emitted on every skip, so the rate of unverified signups is observable.

**Removals.** The `latest-otp.txt` write and the `NODE_ENV !== "production"` bypass are both
deleted. Skip-mode makes dev-without-credentials honest by default, and
`/api/debug/send-test-otp` still exists for exercising the real provider.

### 4. Downstream gates

`POST /api/leads/self-serve` and `POST /api/auth/owner-signup` carry the same 30-minute
freshness check. Both change identically:

```ts
// before
where: { phone, purpose, status: "VERIFIED" }
// after
where: { phone, purpose, status: { in: ["VERIFIED", "SKIPPED"] } }
const phoneVerified = record.status === "VERIFIED";
```

The freshness window (30 min from `verified_at`) and the `PHONE_NOT_VERIFIED` rejection when
no row exists are both unchanged — a caller still cannot reach either endpoint without having
gone through `send-phone-otp` for that exact phone number.

Consumers of `phoneVerified`:

- `authService.selfSignUpOwner()` currently hardcodes `phone_verified: true` /
  `mobile_verified: true` (`auth-service.ts:519-520`). It takes a `phoneVerified: boolean`
  parameter instead and writes it to both columns, so the profile reflects reality. Its doc
  comment is updated — it no longer requires a *verified* row, it requires a *fresh* row.
- `platform_leads` gains `phone_verified Boolean @default(false)`, written from the same
  value.

### 5. Schema change

`platform_leads.phone_verified Boolean @default(false)` — Prisma model plus a hand-written
SQL migration in `migrations/`, matching this repo's convention (applied via the Supabase SQL
editor; order matters). Default `false` is correct for existing rows only in the strict
sense that they are no longer provably verified from the row itself; the historical truth
lives in `phone_verification_otps`. This is acceptable — the column exists to inform admins
about *new* leads.

No schema change is needed for `SKIPPED` / `UNAVAILABLE`: both columns are plain strings.

### 6. Frontend

Both signup surfaces branch on `verification_required`. Neither knows *why* verification was
skipped — that stays server-side.

- `HostelLeadModal.tsx` — `submitDetails()` currently always advances to `step: 'otp'`. When
  `verification_required === false` it calls `hostelLeadsApi.submitLead()` directly and
  advances to `'done'`. The OTP step is never rendered. The phone field stays **required** on
  the details step: an unverified number is still the number StayO calls the lead back on,
  and keeping the field means the form's shape does not change when WhatsApp goes live.
- `OwnerOnboardingWizard` — `submitAccount` skips the OTP bottom sheet on the same condition
  and proceeds straight to `onboardingApi.ownerSignup()`.
- `onboardingApi.sendPhoneOtp` / `hostelLeadsApi.sendLeadOtp` response types gain
  `verification_required: boolean` and optional `reason: string`. Both already go through
  `@lib/api-client`, so the architecture check is unaffected.
- Confirmation copy stays warm — the public signup page should not display an alarming
  "unverified" badge to the person who just signed up. No new UI element on the happy path.

### 7. Admin surface

`AdminLeadsPage.tsx` shows a small muted "unverified number" marker on leads whose
`phone_verified` is false, and the same in the lead drawer. The admin reviewing a lead for
approval should know the number was never confirmed before acting on it. The lead API
response that feeds this page includes the new field.

### 8. Turning verification on

Set the four WhatsApp variables (or `PHONE_VERIFICATION_MODE=on`) and redeploy. Both signup
flows render the OTP step again; both gates keep accepting `SKIPPED` rows, which simply stop
being produced. No code change, no migration.

## Testing

Vitest, in `apps/backend/tests/`:

- **Mode resolver** — truth table: each of the four variables missing in turn → `off`; all
  present → `on`; `PHONE_VERIFICATION_MODE` overriding in both directions; an unrecognised
  override value falling through to derivation.
- **Breaker** — closed→open after 3 failures in window; open short-circuits without calling
  the provider; half-open trial closes on success and re-opens on failure; success resets the
  count. Exercised with the in-process fallback so the suite needs no Redis.
- **`sendPhoneOtp`** — mode `off` writes a `SKIPPED` row and returns
  `verification_required: false` without touching the provider; a provider failure under mode
  `on` degrades the *same* request rather than throwing; a non-signup purpose still throws
  `OTP_SEND_FAILED`; rate limits still apply on the skip path.
- **Gates** — `/leads/self-serve` and `/auth/owner-signup` accept a fresh `SKIPPED` row and
  persist `phone_verified: false`; accept a `VERIFIED` row and persist `true`; still reject
  when no row exists; still reject a row older than 30 minutes.

Tests share a real Postgres connection and run single-worker (`fileParallelism: false`) —
new tests follow the existing per-file isolation conventions.

## Documentation

Per the repo's documentation rule, in the same change:

- `docs/obsidian/Features.md` — degraded signup verification.
- `docs/obsidian/APIs.md` — `send-phone-otp` response gains `verification_required` /
  `reason`; the relaxed gates on `/leads/self-serve` and `/auth/owner-signup`.
- `docs/obsidian/Database.md` — `platform_leads.phone_verified`; the `SKIPPED` /
  `UNAVAILABLE` string values on `phone_verification_otps`.
- `docs/obsidian/Business-Rules.md` — phone verification is required for signup only when
  the provider is available; leads and owner profiles record which.
- `docs/obsidian/Decisions.md` — ADR for skip-over-block, and for degrading the failing
  request rather than only subsequent ones.
- `docs/obsidian/Changelog.md` — entry.
- `docs/data-models/schema.md` — the new column, alongside the Obsidian update.

## Risks

- **An unverified phone is a real phone number nobody confirmed.** Leads may carry typos or
  junk numbers, and an owner account can be created against a number its owner never
  controlled. Accepted deliberately: these leads are human-reviewed before approval, and the
  admin badge makes the state visible. This risk ends when WhatsApp goes live — for new
  signups only.
- **Nothing verifies the backlog.** Accounts and leads created while degraded stay unverified
  indefinitely, by explicit scope decision. If a catch-up is wanted later it is a separate
  piece of work and should get its own ADR.
- **Silent degradation.** With the breaker, a credentials expiry downgrades verification
  without failing loudly. Mitigated by the `otp.request.skipped` metric line; an alert on that
  rate is worth adding but is out of scope here.
