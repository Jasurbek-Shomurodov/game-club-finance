// Signs each test account in through the real /login page, keeps its session for the tests, then snapshots the
// seeded database so every test starts from exactly the fixture (e2e/fixture.mjs).
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { accounts, appUrl, storageStatePath, supabaseUrl } from './settings.mjs';
import { englishCookie, signIn } from './helpers.mjs';

export default async function globalSetup() {
  fs.mkdirSync('e2e/.auth', { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [role, account] of Object.entries(accounts)) {
      const context = await browser.newContext({ baseURL: appUrl, locale: 'en-US', timezoneId: 'Asia/Tashkent' });
      await context.addCookies([englishCookie]);
      const page = await context.newPage();
      await signIn(page, account);
      await context.storageState({ path: storageStatePath(role) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const snapshot = await fetch(supabaseUrl + '/__snapshot', { method: 'POST' });
  if (!snapshot.ok) throw new Error('Could not snapshot the test database.');
}
