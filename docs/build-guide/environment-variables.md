# Environment Variables

Do not commit real secrets.
Use the examples as shapes only.

> The canonical, current list of every variable the app actually reads
> (cross-referenced against the code, grouped by shared vs. per-environment
> and required vs. optional) lives in `.env.example` (repo root) and
> `apps/frontend/.env.example`. This page is kept as narrative context; if
> the two disagree, trust the `.env.example` files.

## Backend variables

| Key | Required | Example shape | Used for |
|---|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/db` | Prisma pooled connection. |
| `DIRECT_URL` | yes | `postgresql://user:pass@host:5432/db` | Prisma direct connection. |
| `DATABASE_URL_TEST` | no | `postgresql://.../test` | Test database. |
| `SUPABASE_URL` | yes | `https://project.supabase.co` | Supabase API. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | `ey...` | Server-side Supabase access. |
| `JWT_SECRET` | yes | `long-random-string` | Access token signing. |
| `NEXT_PUBLIC_FRONTEND_URL` | yes | `https://client.example.com` | Public frontend origin. |
| `FRONTEND_URL` | no | `https://client.example.com` | Backend URL fallback. |
| `NEXT_PUBLIC_APP_URL` | yes | `https://api.client.example.com` | Backend public URL. |
| `API_URL` | no | `https://api.client.example.com` | Backend URL fallback. |
| `BACKEND_URL` | no | `https://api.client.example.com` | Backend URL fallback. |
| `CORS_ALLOWED_ORIGINS` | yes | `https://client.example.com` | Allowed browser origins. |
| `LEGACY_FRONTEND_ORIGINS` | no | `https://old.example.com` | Legacy CORS support. |
| `GOOGLE_CLIENT_ID` | no | `google-client-id` | Google OAuth backend. |
| `GOOGLE_CLIENT_SECRET` | no | `google-client-secret` | Google OAuth backend. |
| `GOOGLE_REDIRECT_URI` | no | `https://client.example.com/callback` | Google OAuth callback. |
| `RESEND_API_KEY` | no | `re_...` | Email delivery. |
| `EMAIL_FROM` | no | `Client <noreply@example.com>` | Email sender. |
| `IMAGEKIT_PRIVATE_KEY` | no | `private_...` | Image uploads. |
| `IMAGEKIT_URL_ENDPOINT` | no | `https://ik.imagekit.io/account` | Image URLs. |
| `RAZORPAY_KEY_ID` | payment | `rzp_test_...` / `rzp_live_...` | Razorpay auth — the only payment provider actually implemented. |
| `RAZORPAY_KEY_SECRET` | payment | `secret` | Razorpay auth. |
| `RAZORPAY_WEBHOOK_SECRET` | payment | `secret` | Verifies `X-Razorpay-Signature` on `/api/webhooks/payments/razorpay`. |
| `RAZORPAY_BASE_URL` | no | `https://api.razorpay.com` | Override only if not using Razorpay's standard host. |
| `PAYMENT_PROVIDER` | payment | `RAZORPAY` | The only currently valid value. |
| `HMS_FINANCIAL_OWNER_ID` | payment | `uuid` | Platform financial owner. |
| `CRON_SECRET` | production | `long-random-string` | Cron route authorization. |
| `RENT_CRON_BATCH_SIZE` | no | `100` | Rent cron batch size. |
| `REDIS_ENABLED` | no | `true` or `false` | Enables optional Redis acceleration. |
| `REDIS_KEY_PREFIX` | no | `hms:prod` | Prefixes Redis keys per environment. |
| `UPSTASH_REDIS_REST_URL` | redis | `https://...upstash.io` | Upstash Redis REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | redis | `AX...` | Upstash Redis REST token. |
| `WHATSAPP_ACCESS_TOKEN` | no | `EA...` | WhatsApp API (preferred name; `WHATSAPP_TOKEN` is a legacy fallback). |
| `WHATSAPP_PHONE_NUMBER_ID` | no | `123456` | WhatsApp sender number (`PHONE_NUMBER_ID` is a legacy fallback). |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | no | `123456` | WABA ID, required by every template-send call. |
| `WHATSAPP_API` | no | `https://graph.facebook.com/v19.0` | WhatsApp base URL. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | no | `verify-token` | Webhook verification (`WHATSAPP_VERIFY_TOKEN` is a legacy fallback). |
| `META_APP_SECRET` | no | `app-secret` | Webhook signature (`WHATSAPP_APP_SECRET` is a legacy fallback). |

**How this works:**
1. Backend routes read `process.env`.
2. Config helpers normalize domains and URLs.
3. Redis helpers no-op when Redis is disabled or missing.
4. Provider services fail or simulate when credentials are missing.

## Frontend variables

| Key | Required | Example shape | Used for |
|---|---|---|---|
| `VITE_API_URL` | yes | `https://api.client.example.com/api` | Backend base URL — `api-client.ts` throws at import time if unset, no fallback. |
| `VITE_SUPABASE_URL` | yes | `https://project.supabase.co` | Must match this environment's backend `SUPABASE_URL`. |
| `VITE_SUPABASE_ANON_KEY` | yes | `ey...` | Public by design — Supabase enforces access control server-side, not by hiding this key. |
| `VITE_GOOGLE_CLIENT_ID` | no | `google-client-id` | Google login provider. |

**How this works:**
1. `apps/frontend` reads Vite variables at build time.
2. `VITE_API_URL` is required with no hardcoded fallback — see `src/lib/api-client.ts`.
3. New clients set `VITE_API_URL`/`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` per their own Vercel project; nothing needs code changes.

**Resolved 2026-08-06** (previously flagged here as "Needs clarification"): `scripts/validate_env.sh` referenced `PHONEPE_*` variables — code has only ever had Razorpay actually implemented, not PhonePe. The script, this page, and `CLAUDE.md` are now corrected to match. See `docs/known-issues.md`.
