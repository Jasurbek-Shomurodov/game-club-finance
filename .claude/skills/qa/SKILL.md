---
name: qa
description: Thorough functional QA of a feature, page, request or recent change in Game Club Finance. Tests the real app end to end (logic, totals, forms, permissions, locales, themes, edge cases) and reports pass/fail with evidence. Use when the user types /qa.
argument-hint: "[empty = full | diff | feature, page or request text | commit | PR | smoke | retest] [fix]"
disable-model-invocation: true
---

# /qa: functional QA

> **Shared contract.** Load the `review-core` skill first (`~/.claude/skills/review-core/SKILL.md`). Its ground rules, argument
> grammar, S0/S1/S2 severity scale, report skeleton, fix mode and fan-out
> apply here. This file adds only what is specific to Game Club Finance.

Target: `$ARGUMENTS` (grammar in `review-core` section 1). Empty or `full`
means every page and the whole checklist below; `diff` means whatever the
uncommitted diff (or else the last commit) changed; a feature, page or
request text means that flow end to end; `smoke` runs only the S0 scenarios
(money totals, club isolation, saving a record).

Your job is to prove the feature works for a real club owner, or to find
exactly where it does not. Do not stop at "tests pass". Investigate until every
item in the checklist below is either verified with evidence or explicitly
marked as not testable, with the reason.

Default to **report only**. Fix bugs only if the arguments contain `fix`
(`review-core` section 4), or after asking at the end.

## 1. Understand what "correct" means

1. Restate the request in one or two sentences: what the user should be able
   to do, and what they should see.
2. Find the change: `git status`, `git diff`, `git log -5 --stat`, or the
   named commit/PR (`gh pr view`, `gh pr diff`).
3. Read only the guides the change touches (see the table in `AGENTS.md`):
   finance → `docs/agents/domain-finance.md`, stock → `docs/agents/inventory.md`,
   DB/RLS → `docs/agents/database.md`, Telegram → `docs/runbooks/telegram-report.md`.
4. Trace the code path end to end: page component → query/RPC →
   `src/lib/calculations` formula → rendering. Write down the expected values
   for the cases you will test **before** looking at the screen.

## 2. Automated checks

Run the narrowest related tests first, then the risk-appropriate set from
`docs/agents/testing.md`:

```bash
npx vitest run <related test files>
npm run typecheck
npm run lint
npm test
```

Add `npm run build` for routing, config or shared-type changes. Note any
missing test for new logic as a finding.

## 3. Drive the real app

The dev server normally already runs on `http://localhost:3000` (otherwise use
`preview_start` with the `web` config in `.claude/launch.json`). The app
requires sign-in:

- Prefer **Claude in Chrome** (the user's Chrome is already signed in). Work in
  a new tab.
- If only the built-in browser is available and it shows `/login`, ask the user
  to sign in there. Never type passwords or use Google sign-in yourself.
- Read-only checks are always fine: opening pages, comparing totals, switching
  dates, clubs, languages and themes, resizing, reading console and network.
- **Data safety: ask before every write.** Any action that could save, change
  or delete data needs the user's explicit "yes" in chat for that one action:
  Save/Submit/Add/Confirm/Delete/Approve/Reject/Withdraw, toggling a setting or
  permission, importing, or the double-click save test.
  - On a real club, do not ask; skip it and list it under "Not tested". Writes
    are only offered on a club the user has said is a test club.
  - Before asking, name the club, page, action and exact values, e.g. "Test
    club, Reports → Add expense 1 000 UZS, cash, today. Proceed?". Then stop and
    wait. Approval covers that action only, never later ones.
  - Never delete or edit records you did not create during this /qa run.
  - List every write you made at the end of the report so the user can
    clean up.
- Never call the Telegram report endpoints or force a resend. Saving an expense
  or salary entry also posts to the club's Telegram group if one is set up:
  say so in the approval question.

For each scenario, use `get_page_text` or `read_page` for values and take
screenshots for anything visual.

### Checklist (cover everything that applies)

- **Happy path**: the main flow, done the way a real owner would do it.
- **Numbers**: compare shown totals against your hand-computed expectation, and
  across the places that must agree: dashboard ↔ money-details page ↔ daily and
  monthly report ↔ financial analysis. Accounting profit and cash-left must stay
  separate.
- **Dates**: today, start of month, a past month, an empty range, the
  business-day boundary (`businessDayStartHour`). Future days must not be
  invented.
- **Forms**: required fields, invalid input, zero, negative, very large amounts,
  `1 000 000` separators while typing, decimals where unit prices allow them,
  double submit, cancel, the error toast or alert.
- **States**: loading skeleton, empty state, error with retry, slow network
  (dimmed rather than flashing).
- **Permissions**: owner, admin and viewer where relevant. A different club must
  never see this club's data.
- **Locales**: RU, UZ, EN. No missing keys or raw message ids, no overflow or
  wrapping in long Russian/Uzbek strings, dates and money formatted for the
  language.
- **Themes**: light and dark (theme toggle in the top bar). Nothing white-on-white
  or invisible.
- **Widths**: 375 px (phone), 768 px, 1280 px, 1920 px. No horizontal scroll,
  nothing clipped.
- **Console**: `read_console_messages` for errors, React warnings and
  hydration mismatches.
- **Network**: `read_network_requests` on first load and after each key action.
  Record the request count, failures (4xx/5xx), duplicate or per-row (N+1)
  requests, serial waterfalls, slow responses (over ~1 s) and oversized
  payloads. Switch club and date range quickly: the last selection must win,
  with no stale data flashing in. Double-click save buttons: exactly one write
  (a write: test club only, after the user approves it).
- **Regression**: nearby features that share the changed component or formula.

## 4. Report

Reply in this shape:

Use the skeleton from `review-core` section 3:

```
QA: <target>   Commit: <sha>   Verdict: PASS | PASS WITH ISSUES | FAIL
Environment: <URL, club, browser, widths, themes, locales>
Checks: vitest X/Y, typecheck, lint, build: <results>

Findings (most severe first)
1. [S0|S1|S2] <page / file:line>: <what is wrong>
   Scenario: Steps ... Expected ... Actual ...   Evidence: screenshot / value / log
   Fix: <concrete change>
   Verified: <reproduced twice; how>

Verified: <scenario>: OK (how it was checked), one line each
Checked, not a finding: ...
Not run: <scenario>: <why>, e.g. needs a viewer account
Data left behind (test club only, each approved): <club, page, record> or none
```

Severity here: **S0** = wrong money or data, a data leak across clubs, or a
crash. **S1** = a broken flow or a misleading UI. **S2** = cosmetic. Finish
by offering to fix the bugs found.
