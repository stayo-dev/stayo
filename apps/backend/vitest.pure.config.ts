import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Config for **pure** unit tests — no `setupFiles`, therefore `lib/db` is never
 * imported and no database is reachable at all.
 *
 * Why this exists: the main `vitest.config.ts` loads `tests/setup.ts`, which
 * imports `@/lib/db` and TRUNCATEs the `test` schema. `lib/db` throws unless
 * `DATABASE_URL_TEST` is set, so with no test database provisioned the *entire*
 * suite is unrunnable — including tests of genuinely pure functions like
 * `buildSettlementPlan`, which take their inputs as plain arguments and touch
 * nothing external.
 *
 * That gap meant financially sensitive allocation logic could not be verified
 * locally at all. Only add files here that import no I/O.
 *
 *   npm run test:pure
 *
 * This is a stopgap, not a replacement: provisioning a real test database and
 * running the full suite is still open work. See ADR-043.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/push-policy.test.ts',
      'tests/push-send-window.test.ts',
      'tests/push-delivery.test.ts',
      "tests/advertised-starting-price.test.ts",
      'tests/settlement-planner.test.ts',
      'tests/settlement-planner-policy.test.ts',
      'tests/settlement-planner-overdue.test.ts',
      'tests/settlement-planner-minimum-percentage.test.ts',
      'tests/invite-settlement-preview.test.ts',
      'tests/search-ranking.test.ts',
      'tests/collection-queue-prioritisation.test.ts',
      'tests/expense-memory.test.ts',
      'tests/food-voting-expiry.test.ts',
      'tests/food-meal-items.test.ts',
      'tests/food-meal-timings.test.ts',
      'tests/food-poll-edit-validation.test.ts',
      'tests/platform-lead-templates.test.ts',
      'tests/platform-lead-stage-mapper.test.ts',
      'tests/owner-document-review.test.ts',
      // Tenant KYC: the shared status helper, and the document routes (which
      // all `vi.mock('@/lib/db')` — no client is constructed).
      'tests/kyc-status.test.ts',
      'tests/tenant-document-verification.test.ts',
      'tests/tenant-kyc-bulk-verify.test.ts',
      'tests/activate-documents-route.test.ts',
      'tests/tenancy-eligibility-rules.test.ts',
      'tests/active-tenancy-selection.test.ts',
      'tests/redis-key-parity.test.ts',
      'tests/activation-enforcement-coverage.test.ts',
      'tests/tenancy-eligibility-service.test.ts',
      'tests/tenancy-eligibility-preview.test.ts',
      'tests/reset-token-channel.test.ts',
      'tests/config-change-labels.test.ts',
      'tests/email-delivery-classification.test.ts',
      'tests/auth-config-diagnostics.test.ts',
      'tests/password-reset-otp-purpose.test.ts',
      'tests/agreement-requirement.test.ts',
      'tests/otp-purpose-label-length.test.ts',
      // Discover + the portable profile. These `vi.mock('@/lib/db')`, so the
      // real client is never constructed and nothing reaches a database —
      // which is what qualifies them for this config.
      'tests/discovery-service.test.ts',
      'tests/profile-identity-service.test.ts',
      'tests/document-vault-service.test.ts',
      'tests/residency-history-service.test.ts',
      'tests/marketing-approval.test.ts',
      'tests/discovery-listing-projection.test.ts',
      'tests/discovery-share-card.test.ts',
      'tests/marketing-mess-import.test.ts',
      'tests/review-summary.test.ts',
      'tests/review-categorization.test.ts',
      'tests/public-route-exceptions.test.ts',
      'tests/review-eligibility.test.ts',
      'tests/photo-tour.test.ts',
      'tests/room-space.test.ts',
      'tests/hostel-navigation.test.ts',
      'tests/post-approval-transitions.test.ts',
      'tests/marketing-review-flags.test.ts',
      'tests/platform-listing-claim.test.ts',
      'tests/platform-listing-enquiry-lead.test.ts',
      'tests/marketing-editor-scope.test.ts',
      'tests/settlement-run-computation.test.ts',
      'tests/owner-payout-promise.test.ts',
      'tests/owner-payout-month.test.ts',
      'tests/owner-export-financial-year.test.ts',
      'tests/owner-export-documents.test.ts',
      'tests/settlement-transitions.test.ts',
      'tests/payout-account.test.ts',
      'tests/enquiry-template-contracts.test.ts',
      'tests/admissions-lead-transition-guards.test.ts',
      'tests/admissions-lead-actions.test.ts',
      'tests/admissions-lead-duplicate-guards.test.ts',
      'tests/tenant-invitation-lifecycle-service.test.ts',
      'tests/floor-room-plan.test.ts',
      'tests/hostel-deletion-plan.test.ts',
      'tests/expense-anomaly.test.ts',
      'tests/tenant-invitation-email-conflict.test.ts',
      'tests/invitation-phone-trust.test.ts',
      'tests/invited-profile-adoption.test.ts',
      'tests/identity-field-policy.test.ts',
      'tests/agreement-commitment.test.ts',
      'tests/activation-account-state.test.ts',
      // The guards deciding who may enter the activation ceremony. ADR-154, ADR-165.
      'tests/activation-entry.test.ts',
      // The owner field-lock while acceptance is pending. ADR-165.
      'tests/owner-field-lock.test.ts',
      'tests/activation-subject.test.ts',
      'tests/invitation-expiry-reminder-contract.test.ts',
      'tests/move-out-quick-exit-plan.test.ts',
      'tests/rent-changeable-agreement.test.ts',
      'tests/rent-change-repricing.test.ts',
      'tests/tenant-transfer-authorization.test.ts',
      'tests/tenant-score-model.test.ts',
      'tests/tenant-identity.test.ts',
      // The resident/guardian command center. Its formatters, vocabulary and
      // reminder policy take plain arguments and touch nothing external —
      // which is the design, not a coincidence: decision logic lives in pure
      // modules so it can be verified without a database.
      'tests/whatsapp-command-center-vocabulary.test.ts',
      'tests/whatsapp-command-center-formatting.test.ts',
      'tests/whatsapp-guardian-reminders.test.ts',
      'tests/whatsapp-guardian-activation-template.test.ts',
      // Reads schema.prisma and the source as text — no client, no database.
      'tests/whatsapp-prisma-accessors.test.ts',
      // The receipt's content model — no pdf-lib, no fonts, no I/O.
      'tests/receipt-content.test.ts',
      // The printed weekly menu's content model. Same split as the receipt —
      // what it says, decided apart from how it is drawn. ADR-144.
      'tests/menu-content.test.ts',
      // Which obligations bind to a room allocation — the rule behind a real
      // double-billing defect. ADR-149.
      'tests/obligation-linking.test.ts',
      'tests/agreement-content.test.ts',
    ],
    alias: {
      // More specific than the catch-all `@` entry below, and must come
      // first: `tsconfig.json`'s `@/*` maps to `./src/*` before falling back
      // to `./*` (see `paths`), but Vitest's plain string alias has no such
      // fallback chain — `@/utils/default-rules` would otherwise resolve to
      // a nonexistent root-level `utils/`, since the real file lives under
      // `src/utils/`.
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@': path.resolve(__dirname, './'),
    },
  },
});
