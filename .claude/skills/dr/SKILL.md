---
name: dr
description: Thorough design and UX review of a page, component, screenshot or Figma frame in Game Club Finance. Checks layout and frames, spacing, empty space, colours and tokens, dark/light themes, typography, states, responsiveness, locales and consistency with the design system. Use when the user types /dr.
argument-hint: "[empty = full | diff | page/route | component | screenshot | Figma URL] [fix]"
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
  empty and error states where you can reach them.
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

## 3. Report

Use the skeleton from `review-core` section 3:

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
