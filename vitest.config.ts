import { defineConfig } from 'vitest/config';

// Node environment for everything: backend tests plus the frontend unit tests,
// which stub the browser globals they need themselves.
export default defineConfig({
  test: {
    include: ['tests/backend/**/*.test.ts', 'tests/integration/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
