import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Next.js resolves `server-only` itself (it is not an npm dependency
      // here); tests run as server code, so use Next's empty server stub.
      'server-only': fileURLToPath(
        new URL('./node_modules/next/dist/compiled/server-only/empty.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    // The Playwright suite under e2e/ has its own runner (npm run test:e2e).
    exclude: ['e2e/**', 'node_modules/**'],
    // The PGlite tests boot an embedded PostgreSQL in beforeAll; on a loaded
    // machine or a small CI runner that takes longer than the 10s default.
    hookTimeout: 60_000,
    // `npm run test:coverage` measures every src file, including ones no test
    // imports, and scripts/check-coverage-floor.mjs compares the result with
    // scripts/coverage-floor.json.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/**/__tests__/**'],
      reporter: ['text-summary', 'lcovonly'],
      reportsDirectory: 'coverage',
    },
  },
});
