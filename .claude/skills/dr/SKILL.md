---
name: dr
description: Thorough design and UX review of a page, component, screenshot or Figma frame in Game Club Finance. Checks layout and frames, spacing, empty space, colours and tokens, dark/light themes, typography, states, responsiveness, locales and consistency with the design system. Arguments: empty or "full", "diff", a page or route, a component, a screenshot, a Figma URL, or an area code (LAY, COL, TYPE, COMP, STATE, RULE, REUSE, PERF, RESP). Use when the user types /dr.
argument-hint: "[empty = full | diff | page/route | component | screenshot | Figma URL | area code (LAY, COL, TYPE, COMP, STATE, RULE, REUSE, PERF, RESP)] [fix]"
disable-model-invocation: true
---

# /dr: design review

> **Shared contract.** Load the `review-core` skill first (`~/.claude/skills/review-core/SKILL.md`). Its ground rules, argument
> grammar, S0/S1/S2 severity scale, report skeleton, fix mode and fan-out
> apply here. This file adds only what is specific to Game Club Finance.

Target: `$ARGUMENTS` (grammar in `review-core` section 1). `diff` means every
screen the uncommitted diff (or else the last commit) touches. Empty, `full`
or `all` means every page under `src/app` and every component under
`src/components`: run the strict-rule scan once, split
the pages into groups of related screens for parallel review, and compare
siblings across groups for reuse. If the arguments contain `fix`, implement the
agreed improvements afterwards. Otherwise review and propose only.

Sources of truth: `AGENTS.md`, `src/components/PresentationFoundation/README.md`
and `references/cases.md`, the design regression catalog. An area code as the
target runs that area's cases on every screen. Keep the catalog alive per
`review-core` section 6.

Judge it like a senior product designer looking at a finance tool that an owner
opens every morning: is the important number obvious, is the screen calm and
dense without being cramped, does it look intentional in both themes and all
three languages?

## 1. Gather the visuals

- **Live app** at `http://localhost:3000` (start `web` from
  `.claude/launch.json` if it is not running). It needs sign-in: prefer
  **Claude in Chrome** (already signed in, use a new tab). In the built-in
  browser, ask the user to sign in. Never enter credentials yourself.
- Capture each target screen at **375, 768, 1280 and 1920 px**, in **light and
  dark** theme, and in **RU** (the longest strings) plus EN. Capture loading,
  empty and error states where you can reach them. For size cases (RESP, COMP,
  dialog fit) use the **full ladder**: 280×653, 320×568, 375×812, 667×375
  (landscape phone), 768×1024, 1024×768, 1180×800, 1440×900, plus the seams
  **414, 540, 600, 820, 912, 1180** and wide 1920 / 2560. Phones and tablets
  with a coarse pointer (`resize_window` mobile preset emulates one), desktops
  with a fine one. The sidebar appears at `lg` (1024): 1024 and 1180 are where
  guessed breakpoints misfire.
- **Two data states per screen.** *Rich*: a club with months of entries, debts,
  salaries and products (`npm run seed:test-data` writes it to the project in
  `.env.local` with the service-role key; `npm run reset:test-data` removes it;
  both need `--confirm` and never run against production). *Sparse*: a fresh
  club with no entries, so every `EmptyState`, zero metric and empty chart
  shows. Switch clubs from the sidebar; do not delete real rows to get there.
- **Size sweep** (fast, covers every screen at every size): with `web` running,
  `node .claude/skills/dr/scripts/size-sweep.mjs` opens the auth routes in
  headless Chromium and prints Audits A, J, M, N and the 16px-input check per
  screen × size. Dashboard routes need a session: copy the `Cookie` request
  header of any signed-in page load from DevTools (Network → the document
  request → Request Headers) into a file outside the repo and pass
  `COOKIES=~/gcf-cookies.txt`, or pass a Playwright storage-state JSON as
  `STATE=`. `BASE=http://localhost:3000` picks the server, `ONLY=/,/debts`
  limits routes, `LANG_CODE=ru` sets the language, `TOUCH_ONLY=1` skips desktop
  sizes and `DIALOGS=1` also opens every page button's modal, drawer or picker
  at 320, 667×375 and 1024 and runs Audit O inside it. It reads only and skips
  buttons whose label looks like a write (save, delete, pay, invite, reset).
  Confirm each hit with a screenshot before reporting it.
- **Overlays are part of their screen; open each one.** Shell (every screen):
  the mobile `Drawer` navigation, club switcher, `LanguageSwitcher`,
  `ThemeToggle`, sign-out, toasts (top on phones, bottom-right on desktop).
  Dashboard: period `SegmentedControl`, month and date pickers, chart tooltips,
  empty chart. Reports: Register expense `Modal`, Entry details `Modal`, delete
  `ConfirmDialog`, `DateRangePicker`. Daily cash: Register expense `Modal`,
  delete confirm. Debts: Add debt, Partial payment. Money taken: carry-over
  confirm, delete confirms. Stock purchase: delete confirm, `DatePicker`.
  Closing stock: `BulkStockUpdateModal`, unsaved-changes confirm. Products:
  add / edit product `Modal`, delete confirm, section filter. Promotions: add /
  edit promotion `Modal`, delete confirm. Salaries: employee `Modal`
  (`SalaryManager`), activate / deactivate confirm, operation forms, employee
  detail, `MonthPicker`. Team: Invite `Modal`, promote / demote / reject /
  remove confirms. Settings: Add club `Modal`. Financial analysis:
  `CategoryDrawer`. Every data page: its skeleton, `EmptyState` and
  `LoadErrorAlert` with Retry.
- **Screenshots** from the user: inspect them closely and zoom into problem
  areas.
- **Figma URL**: pull the frame with the Figma tools (`get_design_context`,
  `get_screenshot`, `get_variable_defs`) and compare against the build: spacing,
  sizes, colours and copy.
- **Reference app**: `/Users/Jasurbek_Shomurodov/Desktop/personal-finance` is
  the visual reference (dark palette, rolling numbers, density). Compare with it
  when the user mentions it.
- Read the source of the screen and the PresentationFoundation components it
  uses (`src/components/PresentationFoundation/README.md`), and the tokens in
  `src/app/globals.css` and `tailwind.config`.

## 2. Review checklist

**Layout and frames**
- Grid and alignment: consistent columns and edges, no orphan cards, a sensible
  card count per row at each width.
- Empty space: dead areas, cards stretched by a taller neighbour, chart areas
  with no data (for example future days), banners with little content, uneven
  section gaps.
- Hierarchy: the headline number dominates, and secondary data is visibly
  secondary. One primary action per area.
- Density: padding and gaps follow a consistent 4 px scale, and the same
  component uses the same spacing on every page.

**Colour and themes**
- Only theme tokens: hard-coded hex, `white`/`black`, or third-party defaults
  (such as the Recharts tooltip) break dark mode.
- Contrast: body text at least 4.5:1, large numbers and icons at least 3:1, in
  both themes. Muted text must still be readable.
- Meaning: green for money in, salmon/red for money out, and warning only for
  attention. The same meaning keeps the same colour everywhere, including
  charts and legends.

**Typography and numbers**
- Type scale and weights are consistent; tabular numbers for money.
- Money and dates are formatted (`1 000 000 UZS`, localized dates), with the
  unit suffix muted. Long amounts do not wrap mid-number.
- RU/UZ strings fit: no truncation that hides meaning, no awkward wrapping.

**Components and interaction**
- Built from PresentationFoundation, with no one-off look-alikes.
- Hover, focus-visible, active and disabled states; touch targets of at least
  40 px on phones.
- Loading uses skeletons that keep the layout stable; empty states explain the
  next step; errors offer retry.
- Motion is purposeful and respects `prefers-reduced-motion`.
- Charts: readable axes, tooltips themed, legend matches the series, and no
  misleading scales.

**Reusability (pages and components)**
- Every page body lives in a `*Page.tsx` next to its `page.tsx` and composes
  `PageHeader` → sections (`Card` + `SectionHeading`) → `DataTable`/metrics.
  Pages built the same way look the same; diff a new page against its closest
  sibling (Debts vs Money taken, Stock purchase vs Closing stock, Bar vs Game
  club money details) and flag any structural drift.
- Duplication: the same markup pattern (three or more elements with the same
  classes) in two or more files is a missing PresentationFoundation component;
  the same query, derived total or form state logic in two or more pages is a
  missing hook or `src/lib` helper. Name the component or helper to extract and
  every call site.
- Near-duplicates: two components that do the same job with different props or
  looks (two list rows, two summary strips, two filter bars) are merged into
  one with a `variant`.
- Before proposing a new component, check `index.ts` and the README table; an
  existing component with a missing variant is extended, not copied.
- A foundation component is generic: no Supabase calls, no translations of
  domain copy, no club or finance types. Domain components live in
  `src/components/<feature>` and are built from foundation parts.
- `className` on a foundation component only places it (margin, grid span,
  width). Restyling colour, padding, radius or typography through `className`
  means a `variant` or `size` is missing.
- Files over about 400 lines, or one component rendering three or more
  independent sections, are split into section components beside the page.

**Strict rules (each hit is at least S1; run the scan, quote the lines)**

```bash
g(){ grep -rnE --include='*.tsx' "$1" src/app src/components | grep -v PresentationFoundation; }
g '<(button|input|select|textarea|table|dialog|details|h[1-4])([ >]|$)'          # raw element: use Button/Field/DataTable/Modal/SectionHeading
g '#[0-9a-fA-F]{3,8}\b|\[(#|rgb)|\b(bg|text|border|fill|stroke|ring)-(white|black|slate|zinc|neutral|red|green|blue|emerald|rose|amber|yellow|orange)\b|-(red|green|blue|emerald|rose|amber|yellow|orange|slate|zinc)-[0-9]'  # non-token colour
g '\b[a-z:-]+-\[[^]]+\]'                                             # arbitrary Tailwind value
g 'style=\{\{'                                                       # inline style
g '\bz-(\[[^]]+\]|[0-9]+)'                                           # ad hoc z-index
g "window\.(confirm|alert)|type=\"(date|month)\"|toLocaleString|toFixed\(|UZS|сум"  # banned APIs and literals
```

1. No raw `button`, `input`, `select`, `textarea`, `table`, `dialog`, `details` or
   headings outside PresentationFoundation (markdown renderers excepted).
2. Colours only from tokens: `gray`, `primary`, `success`, `danger`,
   `warning`, `surface`, `on-accent`. No hex, `white`/`black` or raw Tailwind
   palettes, except third-party brand marks (the Google logo) and `<meta
   themeColor>`.
3. No arbitrary values (`text-[13px]`, `w-[28rem]`) when a scale step exists;
   a value that is genuinely needed in two places becomes a token or a
   component prop. Grid templates and `calc()` layouts are acceptable only
   inside one component.
4. Inline `style` only for runtime values (chart colours, measured heights,
   percentages); never for static styling.
5. z-index comes from one layered scale (content < sticky < nav < overlay <
   toast); report any `z-[…]` and any two overlays that share a layer.
6. One icon set (`lucide-react`), one size per context (16 inline, 18 in
   buttons, 20 in nav), always `aria-hidden` next to text.
7. Radius and shadow come from the component (`Card`, `Modal`, `Button`);
   pages do not set `rounded-*`/`shadow-*` on containers.
8. Type sizes stay on the scale (`text-xs` to `text-4xl`); money uses
   `Money`/`MetricCard` and `tabular-nums`.
9. No user-facing literal strings in JSX; everything goes through
   `en`/`ru`/`uz` with matching shapes.
10. Each page has exactly one `PageHeader`, a skeleton for loading, an
    `EmptyState` for no data and an `InlineAlert` with retry for errors.

**Perceived performance**
- With `read_network_requests`: how long until the main numbers show, whether
  the layout jumps when data arrives, and whether slow requests leave blank
  areas instead of skeletons.

**Responsiveness and accessibility**
- No horizontal page scroll at 375 px; tables become scrollable or turn into
  cards.
- Landmarks and headings, labelled controls, alt and aria text, keyboard order.

## 3. Measure, don't eyeball

Use `javascript_tool` for facts and screenshots only to confirm what a number
says. Paste these audits on each screen (they only read the page). `R` is the
screen's content root: `main#main-content` inside the dashboard shell, `main`
on the auth pages.

```js
// R. Content root, shared by the audits below (paste once per page load)
window.R=document.getElementById('main-content')||document.querySelector('main')||document.body;
```
```js
// A. Overflow: past the window (out), cut off inside a box (clipped), ellipsised (truncated), sideways scrollers
const id=e=>e.tagName.toLowerCase()+'.'+String(e.className?.baseVal??e.className).split(' ').filter(Boolean).slice(0,2).join('.'),all=[...R.querySelectorAll('*')].filter(e=>e.getClientRects().length);
({pageScroll:document.documentElement.scrollWidth>innerWidth+1?document.documentElement.scrollWidth+'>'+innerWidth:null,
out:all.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left<-1)&&!e.closest('[class*=overflow-x-auto],[class*=overflow-auto],.recharts-wrapper')}).slice(0,10).map(id),
clipped:all.filter(e=>{const c=getComputedStyle(e);return /hidden|clip/.test(c.overflowX)&&c.textOverflow!=='ellipsis'&&e.clientWidth>1&&e.scrollWidth>e.clientWidth+1&&e.querySelector('button,a,span,p,strong')&&!e.closest('.recharts-wrapper')}).slice(0,10).map(e=>id(e)+' '+e.scrollWidth+'>'+e.clientWidth),
scrollers:all.filter(e=>/auto|scroll/.test(getComputedStyle(e).overflowX)&&e.scrollWidth>e.clientWidth+1).slice(0,10).map(id),
truncated:all.filter(e=>getComputedStyle(e).textOverflow==='ellipsis'&&e.scrollWidth>e.clientWidth+1).slice(0,10).map(e=>e.textContent.trim().slice(0,30))})
```
`scrollers` are fine only for a `DataTable` scrolling inside its card (it has a
`label` for keyboard users) and a `SegmentedControl variant="chips"` row that is
meant to scroll. A `tabs` strip, `PageHeader` actions or a filter bar that
scrolls is RESP-007. A truncated money figure is TYPE-003, not polish.
```js
// B. Grey sentence under a heading (README: no subtitle under PageHeader, no sentence of explanation under every number)
[...R.querySelectorAll('h1,h2,h3')].map(h=>{const n=h.parentElement?.nextElementSibling||h.nextElementSibling;return n&&n.tagName==='P'&&n.textContent.trim().length>25?h.textContent.trim()+' → '+n.textContent.trim().slice(0,80):null}).filter(Boolean)
```
A hit is a candidate: one subtitle per section is allowed; a paragraph under
the page title or under each `MetricCard` is the failure (LAY-008).
```js
// C. Money formatting in page text and SVG chart labels. Expected: "1 000 000" with spaces and the translated unit
// (сум / so'm / UZS) as a muted suffix; whole sums; a real minus. Flags decimals, comma thousands, an unspaced unit,
// hyphen-minus, a hard-coded "UZS" outside English, and a figure that wraps between lines.
const cur="(?:UZS|so'm|soʻm|сум)",t=R.innerText+'\n'+[...R.querySelectorAll('svg text')].map(x=>x.textContent).join('\n');
const wrapped=[],w=document.createTreeWalker(R,NodeFilter.SHOW_TEXT);for(let n;(n=w.nextNode())&&wrapped.length<8;){for(const m of n.textContent.matchAll(/(?<![+\d])\d[\d   ]{3,}\d\s?(?:UZS|so'm|soʻm|сум)?/g)){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);if(new Set([...r.getClientRects()].filter(q=>q.width>0).map(q=>Math.round(q.top))).size>1){wrapped.push(m[0].trim());break}}}
({decimals:t.match(new RegExp(`\\d[\\d\\s]*[.,]\\d{1,2}\\s?${cur}`,'g')),commaThousands:t.match(new RegExp(`\\d,\\d{3}(?:,\\d{3})*\\s?${cur}`,'g')),unspaced:t.match(new RegExp(`\\d{4,}\\s?${cur}|\\d${cur}`,'g')),hyphenMinus:t.match(new RegExp(`(^|[\\s(])-\\s?\\d[\\d\\s]*\\s?${cur}`,'gm')),literalUZS:document.documentElement.lang!=='en'?t.match(/\d\s?UZS\b/g):null,wrapped})
```
Run it in RU, UZ and EN. Unit costs (`formatUnitCurrency`) may keep up to two
decimals; everything else in `decimals` is TYPE-003, `literalUZS` is RULE-004
(the README: the currency label is always `tc('currency')`). `wrapped` is
TYPE-003 too.
```js
// D. Type scale and radii actually used (compare with the Tailwind scale text-xs..text-4xl and rounded-md/lg/xl/2xl in tailwind.config.ts)
const s=new Map(),r=new Map();R.querySelectorAll('*:not(svg *)').forEach(e=>{const c=getComputedStyle(e);if([...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))s.set(c.fontSize,(s.get(c.fontSize)||0)+1);if(c.borderRadius!=='0px')r.set(c.borderRadius,(r.get(c.borderRadius)||0)+1)});
({fontSizes:Object.fromEntries([...s].sort((a,b)=>parseFloat(a[0])-parseFloat(b[0]))),radii:Object.fromEntries([...r].sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])))})
```
Expected sizes: 12, 13 (`Button sm`), 14, 16, 18, 20, 24, 30, 36 px; radii 6,
8, 12, 14 (`xl`), 18 (`2xl`) px or `9999px`. Anything else is TYPE-001 /
RULE-001 (quote the class); a page setting `rounded-*` on a container is
COMP-006.
```js
// E. Unnamed controls: buttons, links, inputs, selects, textareas (a placeholder is not a name). Run with dialogs open too.
[...document.querySelectorAll('main :is(button,a,[role=button],input:not([type=hidden]),select,textarea), [role=dialog] :is(button,input,select,textarea)')].filter(b=>b.offsetParent&&!((b.matches('button,a,[role=button]')&&b.innerText.trim())||b.getAttribute('aria-label')||b.getAttribute('aria-labelledby')||b.title||b.labels?.length)).map(b=>b.outerHTML.slice(0,120))
```
```js
// F. Language leftovers: English words on a RU or UZ screen, Cyrillic or Uzbek UI words on an EN screen (run in each language)
const lines=R.innerText.split('\n');({english:lines.filter(l=>/\b(the|and|your|with|this|Add|Save|Cancel|Delete|Loading|Search)\b/.test(l)).slice(0,20),notEnglish:document.documentElement.lang==='en'?lines.filter(l=>/[А-Яа-яЁё]|\b(Saqlash|Bekor|O'chirish|Qidirish|Jami)\b/.test(l)).slice(0,20):[]})
```
Product, employee and club names are data; UI chrome in the wrong language is
RULE-005.
```js
// G. Colour tone sanity: danger-toned text that is not money out, a debt, a loss or an error (README: colour only for meaning)
[...R.querySelectorAll('[class*=text-danger]')].filter(e=>e.textContent.trim()).map(e=>(e.closest('li,tr,article,section,[class*=rounded]')?.innerText.split('\n')[0]||'').slice(0,30)+' :: '+e.textContent.trim().slice(0,30)).slice(0,20)
```
```js
// H. Disabled state honesty: looks enabled but aria-disabled only; disabled with no reason given
[...document.querySelectorAll('main button,[role=dialog] button')].filter(b=>b.getAttribute('aria-disabled')==='true'&&!b.disabled&&getComputedStyle(b).opacity==='1').map(b=>'looks enabled: '+b.innerText.trim()).concat([...document.querySelectorAll('main button:disabled,[role=dialog] button:disabled')].filter(b=>b.offsetParent&&!(b.title||b.getAttribute('aria-describedby')||b.parentElement?.title)).map(b=>'disabled, no reason: '+(b.innerText.trim()||b.getAttribute('aria-label'))))
```
A disabled `Button` is plainly grey (README); a primary that happens to be
disabled is COMP-009.
```js
// I. Text contrast below 4.5:1 (COL-002), in light and dark. Colours are normalised through a canvas (Tailwind emits
// rgb(var(--c-*)/α)); mostly transparent backgrounds are skipped to the parent. Check text on gradients by eye.
const cx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
const rgba=c=>{cx.clearRect(0,0,1,1);cx.fillStyle=c;cx.fillRect(0,0,1,1);return [...cx.getImageData(0,0,1,1).data]};
const L=c=>{const [r,g,b,a]=rgba(c);if(a<128)return null;return [r,g,b].map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)};
const bg=e=>{for(;e;e=e.parentElement){const l=L(getComputedStyle(e).backgroundColor);if(l!==null)return l}return L(getComputedStyle(document.body).backgroundColor)??1};
[...document.querySelectorAll('main *, [role=dialog] *')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.offsetParent&&e.clientWidth>1&&!e.closest('svg')).map(e=>{const f=L(getComputedStyle(e).color)??0,b=bg(e),r=(Math.max(f,b)+.05)/(Math.min(f,b)+.05);return [r,e]}).filter(([r])=>r<4.5).slice(0,15).map(([r,e])=>r.toFixed(2)+' '+e.textContent.trim().slice(0,30))
```
Large figures (≥ 24px bold) and icons pass at 3:1 (COL-003). Run in both
themes: `data-theme` on `<html>` forces one, the dark set swaps `--c-*` in
`globals.css`. `text-gray-400` on `bg-gray-50` is the usual dark-mode failure.
```js
// J. Touch targets under 40px (COMP-003). Run at the mobile preset (coarse pointer).
[...document.querySelectorAll('button,a,[role=button],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,summary')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<40&&!e.closest('p')).slice(0,20).map(e=>Math.round(e.getBoundingClientRect().height)+'px '+(e.innerText||e.getAttribute('aria-label')||e.tagName).trim().replace(/\s+/g,' ').slice(0,30))
```
`Button md` is 44px, `sm` 36px, `IconButton sm` 32px by design: a `sm` control
is fine inside a dense table row on desktop and a hit when it is the
only way to act on a phone (COMP-003). Also list inputs under 16px
(`parseFloat(getComputedStyle(input).fontSize)<16`): `Input` is `text-base
sm:text-sm`, so a hit on a phone is a hand-rolled field (COMP-001, RESP-010).
```js
// K. Page frame: title position (top bar on wide screens, page on phones) and tab title (compare across screens)
const h=document.querySelector('h1')?.getBoundingClientRect();({top:h&&Math.round(h.top),left:h&&Math.round(h.left),h1:document.querySelector('h1')?.textContent.trim(),h1Count:document.querySelectorAll('h1').length,title:document.title})
```
```js
// L. Wrapped with room: a row whose items went onto a second line although the first line had space for them
// (a breakpoint guessed for the widest row). Measures each item's content, not its stretched box; full-width rows and column stacks are skipped.
const px=(s,...k)=>k.reduce((t,p)=>t+(parseFloat(s[p])||0),0),id=e=>e.tagName.toLowerCase()+'.'+String(e.className).split(' ').filter(Boolean).slice(0,2).join('.');
const content=k=>{const box=k.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(k);const r=range.getBoundingClientRect();if(!r.width)return box.width;const s=getComputedStyle(k);return Math.min(box.width,r.width+px(s,'paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'))};
const hits=[];for(const box of R.querySelectorAll('*')){const c=getComputedStyle(box),grid=c.display.includes('grid'),flex=c.display.includes('flex');if(!grid&&!flex||flex&&c.flexDirection.startsWith('column')||grid&&c.gridTemplateColumns.split(' ').length<2)continue;
 const inner=box.getBoundingClientRect().width-px(c,'paddingLeft','paddingRight'),kids=[...box.children].filter(k=>k.getBoundingClientRect().width>0&&getComputedStyle(k).position!=='absolute');if(kids.length<2||kids.some(k=>k.getBoundingClientRect().width>=inner*.95))continue;
 const lines=[];for(const k of kids){const r=k.getBoundingClientRect(),w=content(k)+px(getComputedStyle(k),'marginLeft','marginRight'),line=lines.find(l=>r.top<l.bottom-4&&r.bottom>l.top+4);if(line){line.w.push(w);line.bottom=Math.max(line.bottom,r.bottom)}else lines.push({top:r.top,bottom:r.bottom,w:[w]})}
 if(lines.length<2)continue;const gap=parseFloat(c.columnGap)||0,sum=l=>l.w.reduce((s,w)=>s+w,0)+(l.w.length-1)*gap,free=inner-sum(lines[0]),need=Math.min(...lines.slice(1).map(sum));
 if(free>inner*.3&&need+gap<=free)hits.push(id(box)+' free '+Math.round(free)+' of '+Math.round(inner)+'px, line 2 needs '+Math.round(need))}
[...new Set(hits)].slice(0,15)
```
Run it at 1180, 1024 and 768 with the sidebar open (the widths between the
phone and wide desktop, where guessed `sm:`/`md:`/`lg:` breakpoints misfire). A
hit is RESP-008 unless the second line is deliberate (a wrapped chip list that
fills its first line, a chart legend, `PageHeader` actions wrapping on a phone).
Fix with a layout that wraps by itself (`flex-wrap`, `auto-fit` grids), never
by shrinking the type.
```js
// M. Overlap: two visible text or control boxes on top of each other (RESP-009). Skips hidden content
// (closed <details> still has boxes in Chrome), clipped content, sticky/fixed bars and charts.
const shown=e=>{if(!e.checkVisibility({opacityProperty:true,visibilityProperty:true,contentVisibilityAuto:true})||e.closest('svg,.recharts-wrapper,.sr-only,[data-dragging]'))return false;const o=e.getBoundingClientRect();for(let p=e;p;p=p.parentElement){const c=getComputedStyle(p);if(/fixed|sticky/.test(c.position))return false;if(p!==e&&/hidden|clip|auto|scroll/.test(c.overflowX+c.overflowY)){const q=p.getBoundingClientRect();if(o.bottom<=q.top+1||o.top>=q.bottom-1||o.right<=q.left+1||o.left>=q.right-1)return false}}return o.width>2&&o.height>2};
const leaf=[...R.querySelectorAll(':is(button,a,input,select,[class*=badge],strong,small,h1,h2,h3,label,span,p,td)')].filter(e=>(e.matches('button,a,input,select')||[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))&&shown(e)).map(e=>[e,e.getBoundingClientRect()]),hits=[];
for(let i=0;i<leaf.length&&hits.length<10;i++)for(let j=i+1;j<leaf.length;j++){const[a,r]=leaf[i],[b,q]=leaf[j];if(a.contains(b)||b.contains(a))continue;const w=Math.min(r.right,q.right)-Math.max(r.left,q.left),h=Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top);if(w>3&&h>3){hits.push(`"${a.textContent.trim().slice(0,24)}" × "${b.textContent.trim().slice(0,24)}" ${Math.round(w)}x${Math.round(h)}`);break}}
hits
```
```js
// N. Words broken between letters (RESP-011, TYPE-005): a word (split at spaces, hyphens and slashes) whose glyphs sit on two lines.
const hits=[],walk=document.createTreeWalker(R,NodeFilter.SHOW_TEXT);
for(let n;(n=walk.nextNode())&&hits.length<15;){if(!n.parentElement?.checkVisibility()||n.parentElement.closest('svg,.sr-only')||getComputedStyle(n.parentElement).hyphens==='auto')continue;
 for(const m of n.textContent.matchAll(/[^\s\-‐‑–—/]{3,}/g)){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);
  if(new Set([...r.getClientRects()].filter(q=>q.width>0).map(q=>Math.round(q.top))).size>1){hits.push(n.parentElement.className+' "'+m[0]+'"');break}}}
hits
```
The usual cause is `break-all` / `overflow-wrap:anywhere` (it lets a flex or
grid column squeeze to one letter) or a `minmax(0,1fr)` name column beside wide
trailing cells. Russian words are long: give the name a minimum (`flex-1
basis-32` with `flex-wrap`) or move the figures to a second line below a
container width, never shrink the type. `break-words` on the `Drawer` title is
deliberate (it breaks at word boundaries first).
```js
// O. Dialog fit (RESP-012): run with one Modal, Drawer, ConfirmDialog or picker open.
const d=[...document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu],[role=listbox]')].filter(e=>e.offsetParent||getComputedStyle(e).position==='fixed').pop(),r=d.getBoundingClientRect(),out=[];
if(r.left<-1||r.right>innerWidth+1)out.push(`wider than screen ${Math.round(r.left)}..${Math.round(r.right)}/${innerWidth}`);
const sc=[d,...d.querySelectorAll('*')].find(e=>/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1);
if(r.top<-1||(r.bottom>innerHeight+1&&!sc))out.push(`taller than screen ${Math.round(r.top)}..${Math.round(r.bottom)}/${innerHeight}, ${sc?'scrolls':'no scroller'}`);
if(d.scrollWidth>d.clientWidth+1)out.push(`sideways scroll ${d.scrollWidth}>${d.clientWidth}`);
const btn=[...d.querySelectorAll('button')].filter(b=>b.offsetParent&&b.innerText.trim());
btn.filter(b=>{const g=document.createRange();g.selectNodeContents(b);return new Set([...g.getClientRects()].filter(q=>q.width>0).map(q=>Math.round(q.top))).size>1}).forEach(b=>out.push('two-line button: '+b.innerText.trim()));
const foot=[...d.children].reverse().find(c=>c.querySelectorAll('button').length>1);if(foot){const hs=[...foot.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.offsetHeight);if(new Set(hs).size>1)out.push('footer heights '+hs)}
({title:(d.querySelector('h2,[id$=title]')?.textContent||d.getAttribute('aria-label')||'').trim(),width:Math.round(r.width),out})
```
`Modal` is a bottom sheet on phones (`items-end sm:items-center`) and its body
scrolls (`min-h-0 flex-1 overflow-y-auto`): the title and footer must stay in
view at 375×667 and 667×375 with the keyboard up (focus the first field). A
toast must never cover the sheet's Save button (README: toasts go to the top
on phones).
```js
// P. Button sizes (COMP-010): heights by Button size class, two-line labels, icon buttons not square, several primaries per surface.
const bs=[...document.querySelectorAll('main button,[role=dialog] button')].filter(b=>b.offsetParent),by={};
const kind=b=>b.className.includes('min-h-12')?'lg':b.className.includes('min-h-11')?'md':b.className.includes('min-h-9')?'sm':/\bh-8 w-8\b/.test(b.className)?'icon-sm':/\bh-10 w-10\b/.test(b.className)?'icon-md':'other';
bs.forEach(b=>{(by[kind(b)]??=new Set).add(b.offsetHeight)});
({heights:Object.fromEntries(Object.entries(by).map(([k,v])=>[k,[...v].sort((a,b)=>a-b)])),
 twoLine:bs.filter(b=>{const g=document.createRange();g.selectNodeContents(b);return new Set([...g.getClientRects()].filter(q=>q.width>0).map(q=>Math.round(q.top))).size>1}).map(b=>b.innerText.trim().slice(0,30)),
 notSquare:bs.filter(b=>!b.innerText.trim()&&Math.abs(b.offsetWidth-b.offsetHeight)>1).map(b=>(b.getAttribute('aria-label')||'?')+' '+b.offsetWidth+'x'+b.offsetHeight),
 primariesPerSurface:[...document.querySelectorAll('[data-page-actions],[role=dialog],header')].map(s=>[(s.dataset.pageActions!==undefined?'page-actions':s.tagName.toLowerCase()),s.querySelectorAll('button[class*=bg-primary-600],a[class*=bg-primary-600]').length]).filter(([,n])=>n>1)})
```
Expected: `sm` 36, `md` 44, `lg` 48, icon buttons square; `other` is a raw
`<button>` outside PresentationFoundation (COMP-001). More than one primary per
`PageHeader` action row or dialog footer is LAY-004.
```js
// Q. Motion inventory (COMP-007, COMP-011): start it, then open a dialog or switch a page, then read window.__motion.
window.__motion={anims:[],shift:0};new PerformanceObserver(l=>l.getEntries().forEach(e=>{if(!e.hadRecentInput)window.__motion.shift+=e.value})).observe({type:'layout-shift',buffered:false});
const grab=()=>document.getAnimations().forEach(a=>{const t=a.effect?.getTiming?.(),k=a.effect?.getKeyframes?.()??[];window.__motion.anims.push({target:(a.effect?.target?.className||'').toString().slice(0,40),ms:t?.duration,props:[...new Set(k.flatMap(f=>Object.keys(f).filter(p=>!['offset','easing','composite','computedOffset'].includes(p))))].join(',')})});
let n=0;const id=setInterval(()=>{grab();if(++n>20)clearInterval(id)},50);
// later: [...new Map(window.__motion.anims.map(a=>[a.target+a.props,a])).values()], window.__motion.shift
```
Expect durations ≤ 300ms (`motion.ts`: 250ms for dialogs, sheets and pickers),
only `opacity`/`transform` (or a skeleton's `background-position`), nothing
looping except skeletons and `Spinner` inside a pressed button, and a shift
total ≤ 0.1 per page switch. Everything animated must carry
`motion-reduce:transition-none` or an `animate-none` counterpart (COMP-007).

Source checks (Bash, read-only) are the strict-rule greps in section 2 plus:
every `transition`/`animate-` class outside `motion.ts` without a
`motion-reduce:` counterpart (COMP-007), and `Button`/`IconButton` rendered
with a `className` that restyles colour, padding or radius (RULE-006).
Report the file and line.

## 4. Report

Use the skeleton from `review-core` section 3. Every finding quotes the audit
letter and the measured value ("Audit M at 667×375: amount × label 38x12").

```
DR: <target>   Commit: <sha>   Verdict: <one line>
Environment: <widths, themes, locales, data state>

Findings (most impactful first)
1. [S0|S1|S2] <screen / area>: <problem>
   Scenario: seen at <width / theme / locale>   Evidence: <screenshot or measurement>
   Fix: <specific change, e.g. "gap-4 → gap-3; move X into Y's header"> (file)
   Verified: <measured how>

Strict rule hits: <rule # → count, top files>
Reuse opportunities: <component/helper to extract → call sites>
Suggestions / Works well: <short lists>
Checked, not a finding: ...
Not run: ...
Quick wins vs larger redesigns: <split>
```

Severity here: **S0** = unreadable or unusable (content hidden by overflow,
unusable at 375 px, contrast failure, money misformatted). **S1** = a strict
rule or design-system rule broken, a missing loading, empty or error state.
**S2** = polish and consistency.

Attach the key screenshots. For larger proposals, describe or sketch the
before/after layout. With `fix`: implement the changes using tokens and
PresentationFoundation, re-capture the same widths, themes and locales, show
before/after screenshots, and run `npm run typecheck && npm run lint`.
