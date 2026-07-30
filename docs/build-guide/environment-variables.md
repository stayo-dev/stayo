# Environment Variables

Do not commit real secrets.
Use the examples as shapes only.

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
| `PHONEPE_CLIENT_ID` | payment | `client-id` | PhonePe auth. |
| `PHONEPE_CLIENT_SECRET` | payment | `client-secret` | PhonePe auth. |
| `PHONEPE_CLIENT_VERSION` | payment | `1` | PhonePe version. |
| `PHONEPE_MERCHANT_ID` | payment | `merchant-id` | Merchant identity. |
| `PHONEPE_SALT_KEY` | payment | `salt-key` | Legacy signing support. |
| `PHONEPE_SALT_INDEX` | payment | `1` | Legacy signing support. |
| `PHONEPE_ENV` | payment | `SANDBOX` or `PRODUCTION` | Provider environment. |
| `PHONEPE_REDIRECT_URL` | payment | `https://client.example.com/payment-return` | Payment return URL. |
| `PHONEPE_WEBHOOK_USERNAME` | payment | `username` | Webhook basic auth. |
| `PHONEPE_WEBHOOK_PASSWORD` | payment | `password` | Webhook basic auth. |
| `HMS_FINANCIAL_OWNER_ID` | payment | `uuid` | Platform financial owner. |
| `CRON_SECRET` | production | `long-random-string` | Cron route authorization. |
| `RENT_CRON_BATCH_SIZE` | no | `100` | Rent cron batch size. |
| `REDIS_ENABLED` | no | `true` or `false` | Enables optional Redis acceleration. |
| `REDIS_KEY_PREFIX` | no | `hms:prod` | Prefixes Redis keys per environment. |
| `UPSTASH_REDIS_REST_URL` | redis | `https://...upstash.io` | Upstash Redis REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | redis | `AX...` | Upstash Redis REST token. |
| `WHATSAPP_TOKEN` | no | `EA...` | WhatsApp API. |
| `PHONE_NUMBER_ID` | no | `123456` | WhatsApp sender number. |
| `WHATSAPP_API` | no | `https://graph.facebook.com` | WhatsApp base URL. |
| `WHATSAPP_VERIFY_TOKEN` | no | `verify-token` | Webhook verification. |
| `WHATSAPP_APP_SECRET` | no | `app-secret` | Webhook signature. |

**How this works:**
1. Backend routes read `process.env`.
2. Config helpers normalize domains and URLs.
3. Redis helpers no-op when Redis is disabled or missing.
4. Provider services fail or simulate when credentials are missing.

## Frontend variables

| Key | Required | Example shape | Used for |
|---|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | no | `google-client-id` | Google login provider. |

**How this works:**
1. `apps/frontend` reads Vite variables at build time.
2. API URL is hardcoded for non-local hosts.
3. New clients must replace the hardcoded API URL or add env-based config.

> **Needs clarification:** `scripts/validate_env.sh` references Razorpay and SMTP variables, but current payment code uses PhonePe and Resend. Treat the script as stale until updated.
