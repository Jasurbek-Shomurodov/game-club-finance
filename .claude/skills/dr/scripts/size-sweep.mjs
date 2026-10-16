// /dr size sweep (SKILL.md §1): every screen of Game Club Finance at phone, landscape, tablet and desktop sizes, with
// Audits A (overflow), J (touch targets), M (overlap), N (broken words) and the 16px field check; DIALOGS=1 also opens
// every page button's Modal, Drawer, ConfirmDialog or picker and runs Audit O inside it. Read-only: it never clicks a
// button whose label looks like a write, and the club's data is untouched.
//
// Run from the repository root with `web` (next dev) up:   node .claude/skills/dr/scripts/size-sweep.mjs
//
// The auth routes (/login, /forgot-password) need no session. Dashboard routes need the Supabase session cookies of a
// signed-in profile (set by @supabase/ssr as `sb-<project>-auth-token`, sometimes chunked `.0`, `.1`). Export them ONCE:
// in a tab signed in to the same origin as BASE, open DevTools → Network, reload, select the document request and copy
// the value of its `Cookie` request header into a file OUTSIDE the repository (it is a bearer token), e.g.
// ~/gcf-cookies.txt, then run
//   COOKIES=~/gcf-cookies.txt node .claude/skills/dr/scripts/size-sweep.mjs
// A Playwright storage-state JSON (cookies + origins) works too: STATE=~/gcf-state.json. Cookies are re-homed to the
// BASE host, so an export from production works against localhost. Delete the file when done.
//
// Env:  BASE=http://localhost:3000  ONLY=/,/debts  LANG_CODE=ru|uz|en  TOUCH_ONLY=1  DIALOGS=1  OUT=report.txt
//       PLAYWRIGHT_DIR=<folder whose node_modules has playwright> when this repository has none installed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(here, '../../../..');
async function loadPlaywright() {
  const candidates = [repoRoot, process.env.PLAYWRIGHT_DIR, path.join(os.homedir(), 'Desktop/finance-app')].filter(Boolean);
  for (const dir of candidates) {
    const req = createRequire(path.join(dir, 'package.json'));
    for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
      try { const mod = await import(req.resolve(name)); return mod.chromium ? mod : mod.default; } catch { /* try the next one */ }
    }
  }
  console.error('Playwright not found. Either `npm i --no-save playwright && npx playwright install chromium` here, or set PLAYWRIGHT_DIR to a project that has it.');
  process.exit(2);
}
const { chromium } = await loadPlaywright();

const base = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const lang = process.env.LANG_CODE || 'ru';
const publicRoutes = ['/login', '/forgot-password'];
const staffRoutes = ['/', '/balance', '/daily-cash', '/daily-report', '/monthly-report', '/reports', '/income', '/expense', '/expenses', '/debts',
  '/money-taken', '/stock-purchase', '/closing-stock', '/products', '/promotions', '/bar-money-details', '/game-club-money-details',
  '/financial-analysis', '/salaries', '/salaries/employees', '/salaries/operations', '/team', '/settings', '/assistant'];
const state = loadState();
const routes = [...publicRoutes, ...(state ? staffRoutes : [])].filter(r => !only || only.includes(r));
const touchSizes = [[280, 653], [320, 568], [375, 812], [414, 896], [667, 375], [820, 375], [768, 1024], [820, 1180], [912, 1368], [1024, 768]];
const fineSizes = [[768, 1024], [1024, 768], [1180, 800], [1440, 900], [1920, 1080]];
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

function loadState() {
  const home = f => f.replace(/^~/, os.homedir());
  const host = new URL(base).hostname, origin = new URL(base).origin;
  if (process.env.COOKIES) {
    // A raw `Cookie:` header value: name=value; name2=value2
    const text = fs.readFileSync(home(process.env.COOKIES), 'utf8').trim().replace(/^cookie:\s*/i, '');
    const cookies = text.split(/;\s*/).filter(Boolean).map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain: host, path: '/', httpOnly: false, secure: false, sameSite: 'Lax' }; });
    return { cookies, origins: [] };
  }
  if (!process.env.STATE) return null;
  const parsed = JSON.parse(fs.readFileSync(home(process.env.STATE), 'utf8'));
  // The export may come from another origin (production): re-home every entry to BASE.
  parsed.origins = (parsed.origins || []).map(o => ({ ...o, origin }));
  parsed.cookies = (parsed.cookies || []).map(c => ({ ...c, domain: host, path: '/', secure: false }));
  return parsed;
}

// Audits run inside the page; `touch` says whether this context emulates a coarse pointer (44px rule, 16px fields).
const audit = (touch) => {
  const id = e => e.tagName.toLowerCase() + '.' + String(e.className?.baseVal ?? e.className).split(' ').filter(Boolean).slice(0, 2).join('.');
  const label = e => (e.innerText || e.getAttribute('aria-label') || e.title || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
  const root = document.getElementById('main-content') || document.querySelector('main') || document.body;
  const all = [...root.querySelectorAll('*')].filter(e => e.getClientRects().length && e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }));
  const visible = e => { for (let p = e; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.visibility === 'hidden' || c.display === 'none') return false; } return true; };
  const insideScroller = e => { for (let p = e.parentElement; p; p = p.parentElement) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  const res = {};
  res.pageScroll = document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth + '>' + innerWidth : null;
  res.out = all.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && !e.closest('svg,.sr-only,.recharts-wrapper') && visible(e) && !insideScroller(e); }).slice(0, 8).map(id);
  res.clipped = all.filter(e => { const c = getComputedStyle(e); return /hidden|clip/.test(c.overflowX) && c.textOverflow !== 'ellipsis' && e.clientWidth > 1 && e.scrollWidth > e.clientWidth + 1 && e.querySelector('button,a,span,p,strong') && !e.matches('[class*=aspect-]') && ![...e.children].every(k => k.matches('img,picture,video')) && !e.matches('.sr-only,svg *') && !e.closest('.recharts-wrapper'); }).slice(0, 8).map(e => id(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  // A tab strip, filter row or button group that scrolls sideways (the category scroller is meant to).
  res.stripScroll = all.filter(e => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1 && e.matches('[role=tablist],[role=radiogroup],nav,form,[data-page-actions],[data-page-tabs],[class*=filter],[class*=toolbar]')).map(id);
  res.truncated = all.filter(e => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1 && !e.matches('h1')).slice(0, 8).map(e => e.textContent.trim().slice(0, 30));
  res.brokenWords = (() => { const hits = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode()) && hits.length < 8;) { if (!n.parentElement?.offsetParent || n.parentElement.closest('svg,.sr-only') || getComputedStyle(n.parentElement).hyphens === 'auto') continue; for (const m of n.textContent.matchAll(/[^\s\-‐‑–—/]{3,}/g)) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const tops = new Set([...r.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top))); if (tops.size > 1) { hits.push(id(n.parentElement) + ' "' + m[0].slice(0, 24) + '"'); break; } } } return hits; })();
  // A money figure ("1 000 000 сум") split between lines.
  res.wrappedMoney = (() => { const hits = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode()) && hits.length < 6;) { if (!n.parentElement?.offsetParent) continue; for (const m of n.textContent.matchAll(/\d[\d   ]{3,}\d\s?(?:UZS|so'm|soʻm|сум)?/g)) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); if (new Set([...r.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top))).size > 1) { hits.push(m[0].trim()); break; } } } return hits; })();
  res.overlap = (() => { const leaf = [...root.querySelectorAll('button,a,input,select,[class*=badge],strong,small,h1,h2,h3,label,span,p,td')].filter(e => { if (!e.offsetParent || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) || e.closest('svg,.recharts-wrapper,.sr-only,[data-dragging]')) return false; const own = e.getBoundingClientRect(); for (let p = e; p; p = p.parentElement) { const c = getComputedStyle(p); if (/fixed|sticky/.test(c.position) || c.visibility === 'hidden' || c.opacity === '0') return false; if (p !== e && /hidden|clip|auto|scroll/.test(c.overflowX + c.overflowY)) { const q = p.getBoundingClientRect(); if (own.bottom <= q.top + 1 || own.top >= q.bottom - 1 || own.right <= q.left + 1 || own.left >= q.right - 1) return false; } } const t = e.matches('button,a,input,select') || [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!t) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight * 6; }); const boxes = leaf.map(e => [e, e.getBoundingClientRect()]); const hits = []; for (let i = 0; i < boxes.length && hits.length < 8; i++) for (let j = i + 1; j < boxes.length; j++) { const [a, r] = boxes[i], [b, q] = boxes[j]; if (a.contains(b) || b.contains(a)) continue; const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top); if (w > 3 && h > 3) { hits.push(id(a) + ' "' + label(a) + '" × ' + id(b) + ' "' + label(b) + '" ' + Math.round(w) + 'x' + Math.round(h)); break; } } return hits; })();
  if (touch) {
    res.small = [...document.querySelectorAll('button,a,[role=button],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,summary')].filter(e => e.offsetParent && visible(e) && e.checkVisibility() && e.offsetHeight < 40 && !e.closest('p')).slice(0, 12).map(e => e.offsetHeight + 'px ' + label(e));
    res.input16 = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).slice(0, 8).map(e => getComputedStyle(e).fontSize + ' ' + (e.getAttribute('aria-label') || e.name || e.placeholder || id(e)));
  }
  return Object.fromEntries(Object.entries(res).filter(([, v]) => v && (!Array.isArray(v) || v.length)));
};

const OVERLAY = '[role=dialog],[role=alertdialog],[role=listbox],[role=menu]';
const dialogAudit = (selector) => {
  const d = [...document.querySelectorAll(selector)].filter(e => e.offsetParent || getComputedStyle(e).position === 'fixed').pop();
  if (!d) return null;
  const r = d.getBoundingClientRect(), res = { title: (d.querySelector('h2,h3,[id$=title]')?.textContent || d.getAttribute('aria-label') || d.getAttribute('role')).trim().slice(0, 40) };
  const issues = [];
  if (r.left < -1 || r.right > innerWidth + 1) issues.push(`wider than screen ${Math.round(r.left)}..${Math.round(r.right)}/${innerWidth}`);
  if (r.top < -1 || r.bottom > innerHeight + 1) {
    const scroller = [d, ...d.querySelectorAll('*')].find(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1);
    if (!scroller || r.top < -1) issues.push(`taller than screen ${Math.round(r.top)}..${Math.round(r.bottom)}/${innerHeight}${scroller ? ' (scroller inside)' : ' no scroller'}`);
  }
  if (d.scrollWidth > d.clientWidth + 1) issues.push(`sideways scroll ${d.scrollWidth}>${d.clientWidth}`);
  const inner = [...d.querySelectorAll('*')].filter(e => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.right > r.right + 1 || q.left < r.left - 1) && !e.closest('.sr-only') && !/hidden|auto|scroll|clip/.test(getComputedStyle(e.parentElement).overflowX) && getComputedStyle(e).position !== 'fixed'; });
  if (inner.length) issues.push('content past dialog edge: ' + inner.slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + String(e.className?.baseVal ?? e.className).split(' ')[0] + ' "' + (e.innerText || '').trim().slice(0, 18) + '"').join(', '));
  const clipped = [...d.querySelectorAll('*')].filter(e => { const c = getComputedStyle(e); return /hidden|clip/.test(c.overflowX) && c.textOverflow !== 'ellipsis' && e.clientWidth > 1 && e.scrollWidth > e.clientWidth + 1 && !e.matches('.sr-only,[class*=aspect-]'); });
  if (clipped.length) issues.push('clipped: ' + clipped.slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' ' + e.scrollWidth + '>' + e.clientWidth).join(', '));
  if (matchMedia('(pointer: coarse)').matches) {
    const small = [...d.querySelectorAll('button,a,[role=button],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,summary,[role=option],[role=menuitem]')].filter(e => e.offsetParent && e.offsetHeight < 40 && !e.closest('p'));
    if (small.length) issues.push('small targets: ' + small.slice(0, 6).map(e => e.offsetHeight + 'px ' + (e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 20)).join(', '));
    const fonts = [...d.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16);
    if (fonts.length) issues.push('inputs <16px: ' + fonts.slice(0, 4).map(e => getComputedStyle(e).fontSize + ' ' + (e.getAttribute('aria-label') || e.name || e.placeholder || '?')).join(', '));
  }
  const btns = [...d.querySelectorAll('button')].filter(b => b.offsetParent && b.innerText.trim());
  const wrapped = btns.filter(b => { const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) { if (!n.textContent.trim()) continue; const rr = document.createRange(); rr.selectNodeContents(n); if (new Set([...rr.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top / 4))).size > 1) return true; } return false; });
  if (wrapped.length) issues.push('button text on 2+ lines: ' + wrapped.slice(0, 4).map(b => b.innerText.trim().replace(/\s+/g, ' ').slice(0, 24)).join(', '));
  res.issues = issues;
  return res;
};

async function go(page, route) {
  await page.goto(base + route, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  const where = new URL(page.url()).pathname;
  if (where !== route && !where.startsWith(route + '/')) {
    const why = where === '/login' ? 'redirected to sign-in (COOKIES/STATE missing or expired)' : `redirected to ${where}`;
    throw new Error(why);
  }
  // Skeletons gone before measuring.
  await page.waitForFunction(() => !document.querySelector('[class*=animate-pulse],[class*=skeleton]'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Labels in ru / uz / en that read as a write; never clicked.
const skipBtn = /delete|remove|save|apply|pay|paid|invite|promote|demote|reject|revoke|activate|deactivate|reset|clear|sign out|log out|logout|export|download|import|upload|copy|share|confirm|accept|approve|carry|close|o'chir|saqla|to'la|taklif|tozala|chiqish|yuklab|удал|сохран|оплат|пригласи|повыси|понизи|отклон|очист|выйти|скачать|подтверд|перенес/i;

async function dialogsOn(page, route, tag) {
  const buttons = await page.$$eval('button:not([disabled])', bs => bs.map((b, i) => ({ i, name: (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40) })).filter(b => b.name));
  const seen = new Set();
  for (const b of buttons) {
    if (seen.has(b.name) || skipBtn.test(b.name) || /^(Light|Dark|Theme|Previous|Next|Show|Hide|Collapse|Expand|Toggle|\d+)$/i.test(b.name)) continue;
    seen.add(b.name);
    const handle = (await page.$$('button:not([disabled])'))[b.i];
    if (!handle || !(await handle.isVisible())) continue;
    const beforeUrl = page.url();
    try { await handle.click({ timeout: 2000 }); } catch { continue; }
    await page.waitForTimeout(450);
    const d = await page.evaluate(dialogAudit, OVERLAY);
    if (d && d.issues.length) log(`  DIALOG ${tag} ${route} [${b.name}] → "${d.title}": ${d.issues.join(' | ')}`);
    for (let k = 0; k < 3; k++) {
      if (!(await page.$(OVERLAY))) break;
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    }
    if (page.url() !== beforeUrl) await go(page, route).catch(() => {});
  }
}

const browser = await chromium.launch();
const mk = async (touch) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: touch, isMobile: touch, locale: lang === 'uz' ? 'uz-UZ' : lang === 'ru' ? 'ru-RU' : 'en-US', extraHTTPHeaders: { 'Accept-Language': lang }, storageState: state || undefined });
  // src/i18n.ts reads the `locale` cookie (ru by default); set it for BASE's host only.
  await ctx.addCookies([{ name: 'locale', value: lang, domain: new URL(base).hostname, path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', e => log('  PAGEERROR', e.message.slice(0, 160)));
  return page;
};
log(`Sweep ${base} lang=${lang} ${state ? 'with a session: auth + dashboard routes' : 'no COOKIES/STATE: auth routes only'} (${routes.length} routes)`);
let screens = 0;
for (const [touch, sizes] of [[false, fineSizes], [true, touchSizes]].filter(([t]) => !process.env.TOUCH_ONLY || t)) {
  const page = await mk(touch);
  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    try { await go(page, route); } catch (error) { log(`${touch ? 'touch' : 'fine'} ${route} NOT REACHED: ${error.message.split('\n')[0]}`); continue; }
    let hits = 0;
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      const r = await page.evaluate(audit, touch);
      if (Object.keys(r).length) { hits++; log(`${touch ? 'touch' : 'fine'} ${w}x${h} ${route}`, JSON.stringify(r)); }
      if (process.env.DIALOGS && (w === 320 || w === 667 || w === 1024 && !touch)) await dialogsOn(page, route, `${touch ? 'touch' : 'fine'} ${w}x${h}`);
    }
    screens++;
    log(`${touch ? 'touch' : 'fine'} ${route}: ${sizes.length} sizes, ${hits} with findings`);
  }
  await page.context().close();
}
await browser.close();
if (process.env.OUT) fs.writeFileSync(process.env.OUT, out.join('\n'));
log(`Done: ${screens} screen passes.`);
