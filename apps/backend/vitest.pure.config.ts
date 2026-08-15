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
      'tests/settlement-planner.test.ts',
      'tests/settlement-planner-policy.test.ts',
      'tests/settlement-planner-overdue.test.ts',
      'tests/settlement-planner-minimum-percentage.test.ts',
      'tests/search-ranking.test.ts',
      'tests/collection-queue-prioritisation.test.ts',
      'tests/expense-memory.test.ts',
      'tests/food-schedule-rebuild-policy.test.ts',
      'tests/food-voting-expiry.test.ts',
      'tests/food-schedule-generator.test.ts',
      'tests/food-meal-swap.test.ts',
      'tests/platform-lead-templates.test.ts',
      'tests/platform-lead-stage-mapper.test.ts',
      'tests/owner-document-review.test.ts',
      'tests/tenancy-eligibility-rules.test.ts',
      'tests/active-tenancy-selection.test.ts',
      'tests/redis-key-parity.test.ts',
      'tests/activation-enforcement-coverage.test.ts',
      'tests/tenancy-eligibility-service.test.ts',
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
    ],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
