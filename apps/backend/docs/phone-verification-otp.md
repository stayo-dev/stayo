# WhatsApp Phone Verification OTP

## Purpose

Phone verification is auth/security infrastructure. It is intentionally separate
from rent reminders and notification orchestration.

Current scope:

- Send a 6 digit OTP over Meta WhatsApp authentication template `otp_phone`.
- Verify the OTP against a bcrypt hash.
- Mark matching profiles as phone verified.

## Service Boundaries

- `lib/services/auth/auth-otp-service.ts`
  Owns OTP lifecycle, rate limits, hashing, verification, and profile updates.
- `lib/services/auth/whatsapp-auth-provider.ts`
  Owns Meta WhatsApp Authentication Template payloads only.
- `app/api/auth/send-phone-otp/route.ts`
  Public API for issuing OTPs.
- `app/api/auth/verify-phone-otp/route.ts`
  Public API for verification.
- `lib/services/notifications/whatsapp-webhook-event-service.ts`
  Reused for Meta delivery lifecycle callbacks.

Reminder services must not import OTP services.

## Security Model

- OTPs are generated with `crypto.randomInt(100000, 1000000)`.
- Plaintext OTPs are never persisted or returned.
- OTP hashes use bcrypt with cost `10`.
- OTP validity is 5 minutes.
- Maximum verification attempts per OTP is 5.
- Previous `PENDING` OTPs for the same phone and purpose are expired before a
  new OTP is issued.
- Verification is one-time use: `PENDING -> VERIFIED`.

## Rate Limits

- Per phone: 3 sends per 15 minutes.
- Per IP: 10 sends per hour.

Rate limit failures return `OTP_RATE_LIMITED`, log structured events, and
increment OTP metrics.

## State Transitions

- `PENDING -> VERIFIED`
- `PENDING -> EXPIRED`
- `PENDING -> FAILED`

Expired or failed OTPs are never reused.

## Meta Template

Delivery uses an **Authentication-category** template on the Stayo WABA
(`1988504515160911`, sender `+91 76750 80090`).

- Name: `otp` (from `WHATSAPP_OTP_TEMPLATE`)
- Language: `en_US`
- Category: `AUTHENTICATION`

Its approved shape, read from the Graph API rather than assumed:

```
BODY    "OTP Code: {{1}}. This is your OTP code for {{2}}. For your security, do not share this code."
FOOTER  "Expires in 5 minutes."
BUTTONS URL "Copy code" → https://www.whatsapp.com/otp/code/?...&code=otp{{1}}
```

### Why two body variables

Most authentication templates take a single variable (the code). **This one
takes two**, because its approved body names the purpose: `{{1}}` is the code,
`{{2}}` is what the code is for. Both are mandatory. A payload with one body
parameter is rejected outright:

```
(#132000) body: number of localizable_params (1) does not match the expected number of params (2)
```

The Copy code button is equally mandatory and takes the code again as its own
single parameter — Meta counts button parameters separately, and omitting the
button component produces the same `#132000`.

`{{2}}` is user-visible, so `otpPurposeLabel()` maps internal purpose codes to
readable text (`LEAD_CAPTURE` → "sign up", `ParentVerify` → "parent
verification"). Unknown purposes are humanised, never rejected — a new purpose
must never break OTP delivery.

### How the mapping is kept honest

Meta's API reports how many parameters a template takes but never what they
mean, so the meaning is declared once, in
`providers/whatsapp/otp-template-contract.ts`:

```ts
OTP_TEMPLATE_CONTRACT = {
  bodyParameters: ["otp_code", "purpose_label"],
  buttonParameters: ["otp_code"],
}
```

`buildOtpTemplatePayload()` fills the payload from that declaration, and
`checkOtpTemplateContract()` fetches the live template and throws a descriptive
`WhatsAppConfigError` if the counts no longer match. It runs in three places:

| Where | When |
|---|---|
| `npm run check:whatsapp-template` | deploy gate / manually |
| `verifyOtpTemplateContractOnce()` | once per process, before the first template send |
| `GET /api/debug/whatsapp-health` | on demand, reported as `otpTemplate.status` |

Deliberate asymmetry: **drift throws** (every send would fail anyway, and this
says why), but an **unreachable Graph API returns `UNVERIFIED` and does not
throw** — a Meta outage must not take OTP delivery down on top of itself.

### Safely changing the template in Meta

1. Edit and submit the template in WhatsApp Manager. Approval does **not**
   affect production yet — the running code still sends the old shape, and any
   change to the number of `{{n}}` variables (in the body *or* in the button
   URL) starts failing every send with `#132000` the moment it goes live.
2. Run `npm run check:whatsapp-template` against production credentials. If the
   shape changed, it fails with exactly what changed and what to do.
3. Update `OTP_TEMPLATE_CONTRACT` and `buildOtpTemplatePayload()` to match,
   update `tests/whatsapp-otp-template-contract.test.ts`, and deploy **before**
   the new template version is in force.
4. Re-run the check; it should report `OK`.

Never edit the template and deploy nothing. The check exists so that mistake
surfaces in CI or at process start, not as a wave of failed logins.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `OTP_PROVIDER` | yes | `whatsapp` selects this delivery channel. See the rollout note below — it does more than pick a channel. |
| `WHATSAPP_ACCESS_TOKEN` | yes | Permanent system-user token (`WHATSAPP_TOKEN` also read). |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | Sender. `1189750147563493` in production (`PHONE_NUMBER_ID` also read). |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | yes | WABA `1988504515160911`. Required for the template-drift check to read templates. |
| `WHATSAPP_OTP_TEMPLATE` | yes | `otp`. The literal `text` switches to a plain-text message (dev only, no template). |
| `WHATSAPP_OTP_TEMPLATE_HAS_BUTTON` | no | `false` only if the template is ever rebuilt without a Copy code button. |
| `WHATSAPP_API` | no | Graph base URL, default `https://graph.facebook.com/v19.0`. |
| `WHATSAPP_TIMEOUT_MS` / `WHATSAPP_MAX_RETRIES` | no | Existing transport settings; unchanged by this integration. |

## Rollout note — `OTP_PROVIDER=whatsapp` changes signup behaviour

**This is not only a channel switch.** Per [ADR-034], `phone-verification-mode.ts`
resolves phone verification to *enabled* when the provider, token, phone number
id and template are **all** present. Until then, signup degrades gracefully: an
undeliverable OTP writes a `SKIPPED` row and signup proceeds unverified.

Setting all four flips owner/lead signup from graceful degradation to
**mandatory phone verification**. If WhatsApp delivery then breaks, new signups
are blocked rather than waved through.

Recommended staged rollout:

1. Set all WhatsApp variables in Vercel **except** `OTP_PROVIDER`.
2. Deploy, then run `npm run check:whatsapp-template` and check
   `GET /api/debug/whatsapp-health` → `otpTemplate.status: "OK"`.
3. Send to several real numbers via `/api/debug/send-test-otp` (ADMIN-only) and
   confirm receipt on each handset.
4. Verify a correct OTP, an expired OTP, and repeated wrong attempts, tracing
   each by `correlation_id` through the lifecycle logs below.
5. Only then set `OTP_PROVIDER=whatsapp`.

Rollback is unsetting `OTP_PROVIDER`; no code change or migration is involved.

## Observability

Every OTP carries one `correlation_id` — the `phone_verification_otps` row id —
from generation to verification. Meta's callbacks only know their own message
id, so the webhook path re-reads the row by `meta_message_id` to rejoin the
thread.

| Event | Emitted from | Notes |
|---|---|---|
| `otp.generated` | `auth-otp-service` | expiry, max attempts |
| `otp.send.started` | provider | template, language, purpose |
| `otp.send.success` | provider | Meta message id, attempts, `duration_ms` |
| `otp.send.failed` | provider / webhook | Meta error code; `source: "webhook"` for async failures |
| `otp.delivered` | webhook | handset receipt |
| `otp.read` | webhook | only if the user has read receipts enabled |
| `otp.verified` | `auth-otp-service` | attempts used, `time_to_verify_ms` |
| `otp.expired` | `auth-otp-service` | age at expiry |
| `otp.invalid_attempt` | `auth-otp-service` | `CODE_MISMATCH` or `MAX_ATTEMPTS_EXCEEDED`, `locked` |

Phone numbers are always masked to the last 4 digits, and the OTP itself is
never logged.

To trace one OTP end to end, filter logs by its `correlation_id`.

## Webhook Lifecycle

Meta webhook ingestion is centralized at `app/api/webhooks/whatsapp/route.ts`
(canonical; `app/api/webhooks/notifications/whatsapp/route.ts` is a legacy mount
of the same handler).

Delivery status callbacks update:

- `whatsapp_logs` for reminder messages.
- `phone_verification_otps.provider_status` for OTP messages.

Supported provider lifecycle states:

- `SENT`
- `DELIVERED`
- `READ`
- `FAILED`

## Failure Handling

- Provider send failure marks the OTP row `FAILED`.
- Expiry during verification marks the OTP row `EXPIRED`.
- Wrong OTP increments attempts; max attempts marks the row `FAILED`.
- API responses never reveal whether a specific phone is registered.
