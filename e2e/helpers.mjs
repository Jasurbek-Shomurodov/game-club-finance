// Shared steps for the P0 browser tests.
import { expect } from '@playwright/test';
import { anonKey, appUrl, supabaseUrl } from './settings.mjs';

/** The app's language cookie; without it the app is Russian. */
export const englishCookie = { name: 'locale', value: 'en', url: appUrl };

/** Restores the database to the seeded fixture, so each test starts from the same state. */
export async function resetDatabase() {
  const response = await fetch(supabaseUrl + '/__reset', { method: 'POST' });
  if (!response.ok) throw new Error('Could not restore the test database.');
}

/** Whole-sum display with thin thousands groups, as formatCurrency shows every amount: 1 000 000. */
export const uzs = amount => new Intl.NumberFormat('ru-UZ', { maximumFractionDigits: 0 }).format(Math.round(amount)).replace(/[  ]/g, ' ');

/** Signs in on the real login page and waits for the dashboard. */
export async function signIn(page, account) {
  await page.goto('/login');
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible({ timeout: 30_000 });
}

/** The page's main text as a screen reader gets it: rolling figures (RollingText) contribute their final text only. */
export async function pageText(page) {
  return page.locator('#main-content').evaluate(main => {
    const copy = main.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    document.body.append(copy);
    try { return copy.innerText; } finally { copy.remove(); }
  });
}

/** The amount card labelled `label` on the dashboard, e.g. "Game Club Income" → "3 200 000", or null until it is on screen.
 * The unit after the figure is the language's: UZS, сум or so'm. */
export async function dashboardAmount(page, label) {
  const match = (await pageText(page)).match(new RegExp(escape(label) + "\\n+([\\d ]+)\\s*(?:UZS|сум|so'm)"));
  return match ? match[1].trim() : null;
}
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Waits until the dashboard shows `amount` for `label`. */
export async function expectDashboardAmount(page, label, amount) {
  await expect.poll(() => dashboardAmount(page, label), { message: `${label} should be ${uzs(amount)}` }).toBe(uzs(amount));
}

/** Waits until the Game Club Net Profit card's note shows `amount` of game-club-paid expenses. */
export async function expectGameClubExpenses(page, amount) {
  await expect.poll(() => pageText(page), { message: `Game club expenses should be ${uzs(amount)}` })
    .toMatch(new RegExp(`Game club expenses: ${uzs(amount)} (UZS|сум|so'm)`));
}

/** Opens a page from the sidebar and waits for its heading. */
export async function open(page, label, heading = label) {
  await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
}

/** An access token for `account`, straight from the test auth server: for requests that bypass the app. */
export async function accessToken(account) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: anonKey }, body: JSON.stringify({ email: account.email, password: account.password }) });
  if (!response.ok) throw new Error(`Could not sign ${account.email} in: ${response.status}`);
  return (await response.json()).access_token;
}

/** One PostgREST request as `account`, the way the browser client would send it. */
export async function restAs(account, method, path, body) {
  const token = await accessToken(account);
  return fetch(`${supabaseUrl}/rest/v1/${path}`, { method, headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${token}`, prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
