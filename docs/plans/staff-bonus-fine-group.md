# Bonuses and fines in the staff Telegram group

## Goal and flow

The owner has a Telegram group "Pixel Gaming" with staff from both Pixel
branches. Bonuses (Премия) and fines (Штраф) recorded on the Salaries page —
and their deletions — must be posted **there instead of** the branch group
(`TELEGRAM_PIXEL_CHAT_ID` "Pixel Gaming Square", `TELEGRAM_MAIN_CHAT_ID`
"Pixel Gaming (Algoritm)"). Every other salary notice (payments, absences,
rates, KPI, employees) stays in the branch group exactly as today.

The group is shared by two branches, so each message must say which branch it
is about.

## Placement

No UI change. Server-side routing only: `src/lib/telegram/clubChat.ts`,
`src/app/api/salaries/route.ts`, `src/lib/telegram/salaryNotification.ts`.

## Architecture

- New optional env var per target: `TELEGRAM_<TARGET>_STAFF_CHAT_ID`
  (`TELEGRAM_PIXEL_STAFF_CHAT_ID`, `TELEGRAM_MAIN_STAFF_CHAT_ID`,
  `TELEGRAM_BUNKER_STAFF_CHAT_ID`). Both Pixel targets will be set to the same
  chat id. Add `staffChatId(clubId)` to `clubChat.ts`, shaped like
  `ownerChatId`.
- Routing for `bonus`, `fine`, and `entry_deleted` with kind `bonus`/`fine`:
  staff chat when configured; **fallback to `targetChatId`** when it is not, so
  nothing is lost before the env var is set. All other events: unchanged.
- Deletion replies: the deletion notice replies to the original announcement
  only when the stored `telegram_chat_id` equals the chat the notice is going
  to (generalise `clubMessageToReplyTo` to take the allowed chat id, or add a
  staff variant). The stored chat id stays untrusted.
- `rememberMessage` keeps storing the real chat id/message id it posted to.
- Branch label: bonus/fine messages sent to the staff chat start their first
  line with the branch, e.g. `🎁 Премия · <branch>: <employee>`. Take the
  branch from the club's showcase `branch` (ru) if the club has one, else the
  club `name`. Read it in the route with the same club-scoped supabase client.
  Keep the builder pure: pass the label in as an optional input field.
- Check `activityNotification.ts`: `salary_entries` already routes some fines
  (cash-shortage recovery) to the owners group — leave that untouched, and make
  sure nothing posts a bonus/fine twice.

## Data model

None. No migration.

## Docs and config

- `.env.example`: commented optional `TELEGRAM_*_STAFF_CHAT_ID` lines next to
  the owner ones.
- `docs/runbooks/telegram-report.md`: one short paragraph next to the owner
  group paragraph.

## Tests

- `clubChat.test.ts`: `staffChatId` and the reply check against a given chat.
- `salaryNotification.test.ts`: branch label in the bonus/fine lines.
- `src/app/api/salaries/route.test.ts`: bonus/fine (and their deletion) go to
  the staff chat when set, to the branch chat when not; payment/absence still go
  to the branch chat.

## Slices

1. All of the above (small enough for one slice).

## Status

Shipped in a83c54d. Production sets `TELEGRAM_PIXEL_STAFF_CHAT_ID` and
`TELEGRAM_MAIN_STAFF_CHAT_ID` to the "Pixel Gaming" supergroup, which
`@hoggish_bot` is a member of.

## Risks

- Bot `@hoggish_bot` must be a member of the staff group before the chat id
  works; the owner adds it.
