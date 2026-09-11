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
      'tests/rent-generation-exit-date-join.test.ts',
      'tests/imagekit-uploadable.test.ts',
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
      // Dues read inside the transaction that creates the obligations —
      // mocks `@/lib/db`, so no database is reachable.
      'tests/tenant-dues-transaction-scope.test.ts',
      // Reads two service files as text to assert the Hostel identity form's
      // fields survive both the write and the read endpoint — no client, no
      // database.
      'tests/hostel-identity-field-round-trip.test.ts',
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
      // ADR-172 owner subscription billing — Phase 1 schema guard. Reads
      // schema.prisma as text; no client, no database.
      'tests/subscription-billing-schema.test.ts',
      // ADR-172 Phase 2 — pure rules (proration, transitions, guards).
      'tests/subscription-billing-rules.test.ts',
      // ADR-172 Phase 2 — service layer; `vi.mock('@/lib/db')`, no client, no database.
      'tests/subscription-billing-service.test.ts',
      'tests/subscription-founding-onboarding-trigger.test.ts',
      // ADR-172 Phase 3 — enforcement (access + capacity + override); mocks `@/lib/db`.
      'tests/subscription-enforcement.test.ts',
      // ADR-172 Phase 3 — lifecycle expiry + renewal; mocks `@/lib/db`.
      'tests/subscription-lifecycle.test.ts',
      // ADR-172 Phase 3 correction — owner-mutation subscription gate; mocks `@/lib/db` + reads route files.
      'tests/subscription-owner-mutation-guard.test.ts',
      // ADR-172 Phase 5 — admin ops + downgrade + cash; mocks `@/lib/db`.
      'tests/subscription-admin.test.ts',
      // ADR-172 Phase 6.1 — legacy per-hostel platform billing cleanup.
      'tests/legacy-platform-billing-cleanup.test.ts',
      // ADR-172 Phase 6.2 — subscription invoice document (content model + generation).
      'tests/subscription-invoice-content.test.ts',
      'tests/subscription-invoice-document.test.ts',
      // ADR-172 Phase 6.3 — billing error standardization + audit hardening.
      'tests/subscription-error-mapping.test.ts',
      'tests/subscription-audit-events.test.ts',
      // Updated capacity model — included beds + paid extra beds (2026-09-10).
      'tests/subscription-extra-beds.test.ts',
      // Phase 6.6 — recurring paid extra-bed billing.
      'tests/subscription-extra-beds-recurring.test.ts',
      // Phase 6.9 — payment-amount mismatch hardening.
      'tests/subscription-payment-mismatch.test.ts',
      // Phase 6.9 — route-handler-level HTTP tests (see file header for scope/limitation).
      'tests/subscription-route-http.test.ts',
      // The receipt's content model — no pdf-lib, no fonts, no I/O.
      'tests/receipt-content.test.ts',
      // The printed weekly menu's content model. Same split as the receipt —
      // what it says, decided apart from how it is drawn. ADR-144.
      'tests/menu-content.test.ts',
      // Which obligations bind to a room allocation — the rule behind a real
      // double-billing defect. ADR-149.
      'tests/obligation-linking.test.ts',
      'tests/agreement-content.test.ts',
      // Clerk auth webhook (ADR-176). The verification test signs with the real
      // `svix` library in-process; the sync test `vi.mock`s `@/lib/db`. Neither
      // constructs a client or reaches a database.
      'tests/clerk-webhook-verification.test.ts',
      'tests/clerk-user-sync.test.ts',
      'tests/clerk-webhook-endpoint.test.ts',
      'tests/clerk-me-handshake.test.ts',
      'tests/auth-me-dual-session.test.ts',
      'tests/clerk-controlled-onboarding.test.ts',
      // Bulk import: parse-stage failures must name the real cause. The
      // row-limit message used to be swallowed by parseFile's own catch.
      'tests/bulk-import-parse-errors.test.ts',
      'tests/bulk-import-file-type.test.ts',
      'tests/bulk-import-capacity-accounting.test.ts',
      // The two field drops that made imported tenants look massively
      // overdue: no maintenance obligation, no already-paid settlement.
      'tests/bulk-import-financial-fields.test.ts',
      // The owner-facing issue vocabulary: severity, copy that names real
      // values, and grouping so a 3-year-old hostel decides once, not 32 times.
      'tests/bulk-import-issues.test.ts',
      // validateRows defects found by the post-implementation code review:
      // joining date billed in a different format than it was validated in,
      // impossible dates rolled over, "Rs. 8,000" read as 0.8, inactive rooms
      // passing preview, and blocked rows with no issue to explain them.
      'tests/bulk-import-row-validation.test.ts',
      // A cover sheet must not be parsed as the tenant list.
      'tests/bulk-import-workbook-sheets.test.ts',
      'tests/bulk-import-rooms-sheet.test.ts',
      'tests/bulk-import-room-plan.test.ts',
      'tests/bulk-import-template-builder.test.ts',
      'tests/bulk-import-hostel-stamp.test.ts',
      'tests/bulk-import-room-execution.test.ts',
      'tests/bulk-import-chunked-confirm.test.ts',
      'tests/bulk-import-hardening.test.ts',
      'tests/bulk-import-revalidate.test.ts',
      'tests/bulk-import-issue-persistence.test.ts',
      'tests/bulk-import-deferred-dispatch.test.ts',
      'tests/bulk-import-deposit-flag.test.ts',
      'tests/bulk-import-query-shapes.test.ts',
      'tests/bulk-import-dispatch-delivery.test.ts',
      'tests/placeholder-email.test.ts',
      'tests/floor-rename.test.ts',
      'tests/email-otp-service.test.ts',
      'tests/activation-email-gate.test.ts',
      'tests/invitation-nudge.test.ts',
      'tests/build-without-env.test.ts',
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
