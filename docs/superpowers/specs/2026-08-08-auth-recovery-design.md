# Auth recovery: Google sign-in, password reset by email or phone

**Date:** 2026-08-08
**Branch:** `fix/auth-recovery-and-google`
**Status:** approved, implementing

## Problem

Three user-reported failures on production (`yourstayo.com`), investigated 2026-08-08:

1. "Continue with Google" never completes — `/auth/callback` shows `Invalid session`.
2. Email + password login fails with `Unable to connect. Check your internet.`
3. Forgot password never delivers an email.
4. (Feature request) Password reset should be possible by phone OTP, not only email.

## Diagnosis

### Symptoms 1 and 2 share one root cause: Supabase project mismatch

Verified live against production:

- Supabase project `xhoqkhwsnqfwhjsffybs` has Google enabled and publishes a valid **ES256** JWKS key.
- `/auth/v1/authorize?provider=google` hands off to Google correctly (`redirect_uri=…supabase.co/auth/v1/callback`), so the Google Cloud client is configured — which is why the account chooser appears.
- The production backend (`stayo-testing.vercel.app`, commit `f17e27d`, branch `dev`) runs the current ADR-031 middleware. Confirmed by probe: no token → `Authentication required`; malformed token → `Invalid session`.
- The deployed frontend bundle mints tokens against `xhoqkhwsnqfwhjsffybs`, and the API base is same-origin `/api` (Vercel rewrite). The CSRF cookie sets correctly (`Secure; SameSite=lax`).
- Local config is internally consistent: `DATABASE_URL` user is `postgres.xhoqkhwsnqfwhjsffybs`, `SUPABASE_ANON_KEY`'s `ref` claim is `xhoqkhwsnqfwhjsffybs`, `SUPABASE_URL` and `VITE_SUPABASE_URL` both point there. **That project is canonical.**

The string `Invalid session` exists in exactly one place in the repo — `apps/backend/middleware.ts:194` — reachable only when Supabase ES256 verification *and* legacy HS256 verification both reject the bearer token. `verifySupabaseAccessToken()` verifies against `issuer: ${process.env.SUPABASE_URL}/auth/v1`, so a backend pointed at a different project (or an unset/trailing-slash URL) rejects every token the frontend holds.

The login symptom is the mirror image. `POST /api/auth/login` returned 401, and the browser separately logged `GET https://xhoqkhwsnqfwhjsffybs.supabase.co/auth/v1/user → 403` — the frontend's own Supabase project refusing a token its backend had just issued. There is no legacy-token fallback in the login path: `createSessionAndTokens` (`lib/services/auth-service.ts:156`) always mints via `signInWithSupabasePassword` against the backend's project.

`Unable to connect. Check your internet.` is a mislabel, not a network problem: `AuthContext.tsx:224` prints it for any error without `.response`, which includes a thrown `setSession` failure.

**Conclusion:** the production backend's `SUPABASE_URL` / `SUPABASE_ANON_KEY` do not point at `xhoqkhwsnqfwhjsffybs`. This is a Vercel environment fix, not a code fix. The competing explanation — a disabled legacy anon key on the frontend — is the same class of fault and is distinguished by the health-endpoint addition below.

**Linkage integrity: clean.** `npm run reconcile:supabase-identities` (dry run, canonical project) reports 3 profiles already linked, 0 dangling, 0 ambiguous. Because `ensureSupabaseIdentity` returns early for an already-linked profile (`lib/auth/supabase-identity.ts:50`), the wrong-project path never reached a write. No data cleanup is required.

### Symptom 3: password reset email delivery

`POST /api/auth/forgot-password` itself is healthy — probed on production with a non-existent address, returned 200 with the generic message. The failures are downstream:

- `lib/services/email-service.ts:9-13` documents that the Stayo Resend account has **no verified sending domain**, falling back to `onboarding@resend.dev`, which Resend delivers only to the account owner's own address. `EMAIL_FROM` is `StayO <admin@yourstayo.com>`, so delivery depends on `yourstayo.com` being verified at resend.com/domains.
- `authService.requestPasswordReset` (`lib/services/auth-service.ts:319-325`) catches send failures and returns the success message regardless. Total delivery failure is indistinguishable from success, for users *and* operators.
- The email is still branded "Sri Adithya Boys Hostel" (`auth-service.ts:295`).

### Symptom 4: phone reset does not exist, but the parts do

`profile.phone` is `String? @unique` with a `phone_verified` flag. `lib/services/auth/auth-otp-service.ts` already provides bcrypt-hashed OTPs, 5-minute TTL, a 5-attempt cap, per-phone (3/15min) and per-IP (10/hr) send limits, a verify lock against replay, and an atomic `PENDING → VERIFIED` transition. `SKIPPABLE_OTP_PURPOSES` is limited to `PHONE_VERIFICATION` and `LEAD_CAPTURE`, so a new `PASSWORD_RESET` purpose **fails closed** when WhatsApp is unavailable rather than waving the caller through.

### Secondary defect: Google rejections are unexplainable

`lib/auth/supabase-session.ts` computes specific rejection codes (`NO_STAYO_ACCOUNT`, `ACCOUNT_DISABLED`, `TENANT_GOOGLE_NOT_ALLOWED`) and its header comment says `/api/auth/me` consumes them. It does not: `/api/auth/me` calls `getSession()`, which collapses every rejection to `null` → a flat `Unauthorized`. `AuthCallbackPage.tsx:12-18` claims to show the specific reason and cannot. The wiring was never finished.

## Decisions

**ADR: Google sign-in is available to tenants** (supersedes the Owner/Admin-only restriction in ADR-031). The never-auto-provision invariant is unchanged — an unknown Google email is still rejected, never turned into an account. Tenant-status gates enforced by `/api/auth/login` (notably `INVITED` → "Account not activated") must be mirrored in `resolveSupabaseSession` so the Google path cannot bypass them.

**Reset UX: pick-a-method first.** `/forgot-password` presents Email or WhatsApp as an explicit choice, then the matching step, rather than a toggle above a shared input.

**Phone reset converges on the existing reset endpoint.** OTP verification returns a short-lived, channel-tagged reset token which the client submits to the existing `POST /api/auth/reset-password`. Password-setting, the one-time-use Redis lock, session revocation, and Supabase identity sync keep exactly one implementation.

## Design

### Backend

1. **`GET /api/health` gains an `auth` block** — `supabase_project_ref`, `expected_issuer`, `jwks_reachable`. The project ref is already public in the frontend bundle, so this discloses nothing; it turns today's multi-hour trace into one `curl`, in the same spirit as the existing `commit`/`branch` fields.

2. **`/api/auth/me` surfaces the real rejection reason.** When `x-auth-mode: supabase`, call `resolveSupabaseSession` directly and, on failure, return the specific code and message with 403. Generic `getSession()` behavior for all other routes is untouched.

3. **Tenant Google access.** Remove the `TENANT_GOOGLE_NOT_ALLOWED` branches (`supabase-session.ts:66-75`, `:110-112`); add the `INVITED` tenancy gate. Update the corresponding case in `tests/auth-hardening-security.test.ts`.

4. **Forgot-password email honesty.** Inspect `EmailService.sendEmail`'s `{sent, error}` result; log at error level and write a `PASSWORD_RESET_EMAIL_FAILED` event on failure. The response stays generic for account-existence reasons, with one exception: when the failure is **systemic and account-independent** (`RESEND_API_KEY` absent, or the `resend.dev` sandbox sender in play) it returns `delivery_degraded: true`. That enumerates nothing while letting the UI stop lying. Re-theme the email with the existing `emailShell`/`emailButton` helpers and Stayo branding.

5. **Reset token options.** `generateResetToken(email, { expiresIn = "1h", channel = "email" })` and `verifyResetToken` returning the channel. Defaults preserve today's behavior. A phone-issued token gets 5 minutes and `channel: "phone"`, so it cannot be substituted for an email token.

6. **New endpoints** (both added to `PUBLIC_CSRF_ROUTES` — public, CSRF-protected):

   ```
   POST /api/auth/forgot-password/phone   { phone }
     → normalizeWhatsAppPhone, look up profile by phone
     → always generic 200 (no phone enumeration)
     → if account exists and is_active: sendPhoneOtp(purpose "PASSWORD_RESET")

   POST /api/auth/verify-reset-otp        { phone, otp }
     → authOtpService.verifyPhoneOtp(purpose "PASSWORD_RESET")
     → { reset_token }  (5 min, channel "phone")

   POST /api/auth/reset-password          { access_token, new_password }   ← existing, unchanged
   ```

   Both carry the same per-identifier and per-IP stateless rate limits the email path uses.

### Frontend

7. **Three-step `/forgot-password`** — choose method → enter identifier → set password (OTP entry and the new password share the final screen, so a verified code is spent immediately). Replaces hardcoded `#FFFDF5`/`#1B2D5B`/`#F07B1D` with the semantic design tokens the rest of the app uses. One single-stroke icon per concept: envelope, chat bubble, key. The WhatsApp option hides itself when the API reports delivery is unavailable — no dead buttons.

8. **Honest session errors.** `AuthContext`'s login catch distinguishes "could not reach the server" from "the server answered but the session was rejected." `AuthCallbackPage` renders the specific Google rejection reason from item 2.

### Verification

9. Backend tests for the new endpoints and the reason-surfacing, registered in `vitest.pure.config.ts`'s explicit include allowlist (a new test file silently never runs otherwise). Owner, tenant, and admin each verified end-to-end: login → authenticated request → logout → confirm the old token is rejected. `apps/frontend` has no test suite, so its side is manual against the running app.

## Out of scope

- Changing the Supabase project itself, or any migration of `auth.users`.
- The `/lead-signup/callback` lead-capture Google flow, beyond confirming it recovers once the env is corrected (it shares the same OAuth client).
- SMS as a reset channel. WhatsApp is the only OTP transport implemented.

## Operator actions (cannot be done from code)

1. Vercel → backend project (`stayo-testing`) → `SUPABASE_URL` = `https://xhoqkhwsnqfwhjsffybs.supabase.co` exactly (no trailing slash); `SUPABASE_ANON_KEY` = the key whose `ref` claim is `xhoqkhwsnqfwhjsffybs`. Redeploy.
2. Supabase → Auth → URL Configuration → Redirect URLs: add `https://yourstayo.com/auth/callback` and `https://yourstayo.com/lead-signup/callback`. (Not verifiable read-only — Supabase validates `redirect_to` at the callback stage, not at authorize time.)
3. resend.com/domains: verify `yourstayo.com`, otherwise `admin@yourstayo.com` mail reaches only the Resend account owner.

Related vault pages: [[APIs]], [[Features]], [[Business-Rules]], [[Decisions]], [[Bugs]], [[Changelog]]
