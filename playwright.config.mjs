// Browser tests of the P0 flows (e2e/), against a production build of the app and the test Supabase in
// e2e/fake-supabase.mjs (the migration chain in PGlite). Build first with `node e2e/build.mjs`, then
// `npm run test:e2e`; `npm run test:e2e:full` does both.
import { defineConfig, devices } from '@playwright/test';
import { blankedEnv } from './e2e/env.mjs';
import { anonKey, appUrl, ownerBotUsername, serviceKey, storageStatePath, supabaseUrl } from './e2e/settings.mjs';

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.mjs/,
  // One database for the run, restored from a snapshot before each test, so tests run one at a time. Every test is
  // independent of the others, so `fullyParallel` only lets CI split the one spec file into shards by test (--shard).
  workers: 1,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.mjs',
  use: {
    baseURL: appUrl,
    storageState: storageStatePath('owner'),
    locale: 'en-US',
    timezoneId: 'Asia/Tashkent',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: [
    {
      command: 'node e2e/fake-supabase.mjs',
      url: supabaseUrl + '/auth/v1/.well-known/jwks.json',
      reuseExistingServer: false,
      timeout: 180_000,
      env: { E2E_SUPABASE_PORT: new URL(supabaseUrl).port },
    },
    {
      // `--` stops newer npx (npm 11.17) reading next's -p as its own --package and exiting.
      command: `npx --no -- next start -p ${new URL(appUrl).port} -H ${new URL(appUrl).hostname}`,
      url: appUrl + '/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...blankedEnv(), NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, NEXT_PUBLIC_TELEGRAM_OWNER_BOT_USERNAME: ownerBotUsername, SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    },
  ],
});
