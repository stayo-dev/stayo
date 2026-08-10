import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });


export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    setupFiles: [path.resolve(__dirname, './tests/setup.ts')],
    include: ['tests/**/*.test.ts', 'apps/backend/tests/**/*.test.ts'],
    exclude: ['tests/import-recovery.test.ts', 'lib/**/*.test.ts', 'node_modules', 'dist'],
    testTimeout: 30000,
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
