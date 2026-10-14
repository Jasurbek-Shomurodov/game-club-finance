---
name: dr
description: Thorough design and UX review of a page, component, screenshot or Figma frame in Game Club Finance. Checks layout and frames, spacing, empty space, colours and tokens, dark/light themes, typography, states, responsiveness, locales and consistency with the design system. Use when the user types /dr.
argument-hint: "[page/route, component, screenshot, Figma URL, or empty for UI touched by the diff] [fix]"
disable-model-invocation: true
---

# /dr: design review

Target: `$ARGUMENTS`. If empty, review every screen the uncommitted diff (or
else the last commit) touches. If the arguments contain `fix`, implement the
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

**Responsiveness and accessibility**
- No horizontal page scroll at 375 px; tables become scrollable or turn into
  cards.
- Landmarks and headings, labelled controls, alt and aria text, keyboard order.

## 3. Report

```
DR: <target>   Overall: <one-line verdict>

Issues (most impactful first)
1. [High|Medium|Low] <screen / area>: <problem>
   Seen at: <width / theme / locale>   Evidence: <screenshot>
   Proposal: <specific change, e.g. "gap-4 → gap-3; move X into Y's header"> (file)

Works well: <short list>
Quick wins vs larger redesigns: <split>
```

Attach the key screenshots. For larger proposals, describe or sketch the
before/after layout. With `fix`: implement the changes using tokens and
PresentationFoundation, re-capture the same widths, themes and locales, show
before/after screenshots, and run `npm run typecheck && npm run lint`.
