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
    ],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
