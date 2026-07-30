// @deprecated Exactly one consumer app-wide (domains/payments/api/verify.ts) —
// everything else imports @lib/api-client directly. See
// docs/migration/frontend-foundation-tracker.md. Do not import in new code.
export { default as api, publicApi, requestWithRetry, sleep } from '@/lib/api-client';
