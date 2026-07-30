// @deprecated This outer barrel has zero consumers anywhere in the app (the
// inner domains/payments/api/* is still used by 3 legacy files — see
// docs/migration/frontend-foundation-tracker.md). Do not import in new code.
export * from './api';
