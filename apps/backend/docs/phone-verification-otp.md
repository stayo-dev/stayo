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

Template:

- Name: `otp_phone`
- Language: `en_US`

The provider sends the OTP in the body and URL button components, matching
Meta's WhatsApp authentication template format.

## Webhook Lifecycle

Meta webhook ingestion remains centralized at:

- `app/api/webhooks/notifications/whatsapp/route.ts`

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
