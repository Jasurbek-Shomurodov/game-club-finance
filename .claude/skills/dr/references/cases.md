# Design regression catalog (Game Club Finance)

Severity if failed (`review-core` section 2): **S0** unreadable or unusable
(overflow hides content, unusable at 375 px, contrast failure, money
misformatted); **S1** a strict rule or design-system rule broken, a missing
loading, empty or error state; **S2** polish. Each case says how to measure
it. IDs are stable; append, never renumber. `[dr YYYY-MM-DD]` marks a case
added from a finding in that run.

Tokens: `src/app/globals.css` and `tailwind.config`; components:
`src/components/PresentationFoundation/README.md`. Strict-rule greps are in
`SKILL.md` section 2.

## Run log (newest first; `retest` starts from the top row)

| Date | Commit | Scope | Findings (S0/S1/S2) | Checks run | Not run |
|---|---|---|---|---|---|

## LAY — layout and frames

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| LAY-001 | S1 | Consistent grid and edges | Screenshot each page at 1280 px; measure card left edges | Cards align to one grid; no orphan card alone in a row |
| LAY-002 | S1 | No dead space | Inspect each page at 1920 px | No empty area wider than a card; cards do not stretch to a taller neighbour |
| LAY-003 | S1 | Headline number dominates | Compare font sizes of the headline metric and secondary data | Headline at least one scale step larger and heavier |
| LAY-004 | S1 | One primary action per area | Count `variant="primary"` buttons visible per section | At most one |
| LAY-005 | S1 | 4 px spacing scale | `getComputedStyle` gap and padding on cards and sections | Multiples of 4; the same component has the same spacing on every page |
| LAY-006 | S1 | Exactly one `PageHeader` per page | `grep -c "<PageHeader" src/app/\(dashboard\)/*/*Page.tsx` | 1 per page |
| LAY-007 | S2 | Section gaps even | Measure gaps between sections on a page | All equal |

## COL — colour and themes

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| COL-001 | S1 | Only token colours | Strict-rule grep 2 in `SKILL.md` | No hex, `white`/`black` or raw palette outside brand marks and `themeColor` |
| COL-002 | S0 | Body text contrast | Measure text on surface in both themes | At least 4.5:1 |
| COL-003 | S0 | Large numbers and icons contrast | Measure metric values and icons | At least 3:1 |
| COL-004 | S1 | Money in green, money out red, warning only for attention | Inspect cards, tables, chart legends | Same meaning, same token everywhere |
| COL-005 | S1 | Dark theme covers third-party parts | Open a chart tooltip in dark mode | Tooltip background and text themed |
| COL-006 | S1 | Muted text readable | Measure `text-gray-*` secondary text in dark mode | At least 4.5:1 |
| COL-007 | S2 | Theme toggle persists | Toggle dark, reload | Theme kept with no flash of light |

## TYPE — typography and numbers

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| TYPE-001 | S1 | Type sizes on the scale | `grep -rnE "text-\[" src/app src/components` | None; `text-xs` to `text-4xl` only |
| TYPE-002 | S1 | Money uses `Money` or `MetricCard` with tabular numbers | `grep -rn "formatCurrency(" src/app src/components --include=*.tsx` | Amount text rendered through `Money`/`MetricCard` with `tabular-nums` |
| TYPE-003 | S0 | Money formatted with grouping and unit | Read any total | `1 000 000 UZS`, unit muted, no wrap mid-number |
| TYPE-004 | S1 | Dates localized | Read a date in RU and UZ | Localized month names, no ISO strings |
| TYPE-005 | S1 | RU and UZ strings fit | Nav, buttons, headers in RU at 375 px | No truncation that hides meaning |
| TYPE-006 | S2 | Weights consistent | Compare headings across pages | Same weight per level |

## COMP — components and interaction

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| COMP-001 | S1 | No raw elements outside the foundation | Strict-rule grep 1 | No `button`, `input`, `select`, `textarea`, `table`, `dialog`, `details` or headings in pages |
| COMP-002 | S1 | Hover, focus-visible, active, disabled states | Tab through a form | Visible focus ring; disabled state dimmed |
| COMP-003 | S1 | Touch targets at least 40 px on phones | Measure buttons and row actions at 375 px | Height ≥ 40 px |
| COMP-004 | S1 | Confirm dialogs are in-app | `grep -rn "window.confirm" src` | None; `useConfirm` used |
| COMP-005 | S1 | Icons from one set, one size per context | `grep -rn "lucide-react" src \| wc -l` and sizes | 16 inline, 18 in buttons, 20 in nav; `aria-hidden` next to text |
| COMP-006 | S1 | Radius and shadow from the component | `grep -rnE "rounded-\|shadow-" src/app --include=*.tsx` | None on page containers |
| COMP-007 | S2 | Motion respects reduced motion | `grep -rn "prefers-reduced-motion" src/app/globals.css src/components/PresentationFoundation/motion.ts` | Animations disabled or shortened |
| COMP-008 | S2 | Charts readable | Inspect axes, legend, tooltip | Legend matches series; no misleading scale |

## STATE — loading, empty, error

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| STATE-001 | S1 | Every page has a skeleton | `grep -L "Skeleton" src/app/\(dashboard\)/*/*Page.tsx` | No page listed |
| STATE-002 | S1 | Every page has an empty state | `grep -L "EmptyState" src/app/\(dashboard\)/*/*Page.tsx` | No data page listed |
| STATE-003 | S1 | Every page has an error with retry | `grep -L "InlineAlert\|LoadErrorAlert" src/app/\(dashboard\)/*/*Page.tsx` | No data page listed |
| STATE-004 | S1 | Skeleton keeps the layout | Throttle the network; compare skeleton and loaded screenshots | No layout jump |
| STATE-005 | S2 | Empty state explains the next step | Read the copy | Names the action (add income, add product) |

## RULE — strict rules

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| RULE-001 | S1 | No arbitrary Tailwind values | Strict-rule grep 3 | None where a scale step exists |
| RULE-002 | S1 | No inline style for static styling | Strict-rule grep 4 | Only runtime values (chart colours, measured heights) |
| RULE-003 | S1 | z-index from one scale | Strict-rule grep 5 | No `z-[…]`; no two overlays on one layer |
| RULE-004 | S1 | No banned APIs or literals | Strict-rule grep 6 | No `window.confirm`, native date inputs, `toLocaleString`, `toFixed`, literal `UZS`/`сум` |
| RULE-005 | S1 | No literal strings in JSX | `grep -rnE ">[A-Za-zА-Яа-я][^<{]{3,}<" src/app src/components --include=*.tsx` | Everything through `en`/`ru`/`uz` |
| RULE-006 | S1 | `className` only places a foundation component | Read `className` props passed to foundation components | Margin, grid span, width only; no colour, padding, radius or type changes |

## REUSE — pages and components

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| REUSE-001 | S1 | Pages compose the same structure | Diff Debts vs Money taken, Stock purchase vs Closing stock, Bar vs Game club money details | `PageHeader` → `Card` + `SectionHeading` → `DataTable`/metrics; no structural drift |
| REUSE-002 | S1 | No repeated markup pattern | Three or more elements with the same classes in two files | Extracted into a foundation component |
| REUSE-003 | S1 | No near-duplicate components | List list rows, summary strips, filter bars | One component with a `variant` |
| REUSE-004 | S1 | Foundation components stay generic | `grep -rn "supabase\|useTranslations" src/components/PresentationFoundation` | None |
| REUSE-005 | S2 | Files under about 400 lines | `wc -l src/app/\(dashboard\)/*/*Page.tsx` | Larger pages split into section components |

## PERF — perceived performance

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| PERF-001 | S1 | Main numbers appear fast | `read_network_requests` on Dashboard | Headline figures within one round trip |
| PERF-002 | S1 | No layout jump when data arrives | Compare before and after screenshots | Same positions |
| PERF-003 | S1 | Slow requests leave skeletons, not blanks | Throttle to Slow 3G | Skeletons until data |
| PERF-004 | S2 | Images sized | Club logo requests | Served at display size |

## RESP — responsiveness and accessibility

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| RESP-001 | S0 | No horizontal scroll at 375 px | `document.documentElement.scrollWidth` on each page | Equals the viewport width |
| RESP-002 | S0 | Tables usable at 375 px | Open DataTable pages | Scroll inside the card or card layout |
| RESP-003 | S1 | 768, 1280, 1920 px | Screenshot each | Sensible card count per row; nothing clipped |
| RESP-004 | S1 | Landmarks and headings | `read_page` on each page | One `h1`, nav and main landmarks |
| RESP-005 | S1 | Labelled controls | `read_page` on each form | Every input has a label; icon buttons have `aria-label` |
| RESP-006 | S2 | Keyboard order | Tab through a page | Logical order; no trap |
