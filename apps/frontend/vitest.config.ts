import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Node-environment unit tests only — no jsdom, no component rendering.
 *
 * `apps/frontend` had no test suite at all before this. Rather than bolt a
 * full DOM harness onto it, decision logic that must not be got wrong (see
 * `features/owner-tenants/invite/inviteDelivery.ts`) is written as pure
 * functions and tested directly, leaving components as thin renderers over
 * already-tested state.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@features': path.resolve(__dirname, './src/features'),
      '@domains': path.resolve(__dirname, './src/domains'),
      '@platforms': path.resolve(__dirname, './src/platforms'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@infrastructure': path.resolve(__dirname, './src/infrastructure'),
      '@context': path.resolve(__dirname, './src/context'),
    },
  },
});
