# Owner money bot runbook

Read this before changing or operating the owner money bot
(`docs/plans/owner-money-bot.md`): a separate Telegram bot that talks only to
club owners in private chats. It is not the club-group bot of
`docs/runbooks/telegram-report.md` and never posts to a group.

## Pieces

| Piece | Where |
|---|---|
| Webhook | `src/app/api/telegram/owner-bot/route.ts` (`POST`) |
| Logic | `src/lib/telegram/ownerBot/`: `update.ts` (which updates count), `commands.ts`, `handler.ts` (messages), `callbacks.ts` (button presses), `callbackData.ts` (`v1:<action>:<id>`), `actions.ts` (the 192 wrappers and their refusals), `day.ts` (the day's figures), `dayView.ts` (lines, states, undo), `keyboard.ts`, `texts.ts` (Russian replies), `telegramApi.ts` (`answerCallbackQuery`, `editMessageText`), `webhookAuth.ts`, `webhookSetup.ts` |
| Database | Migration 190 (links, one-time codes, handovers, `owner_bot_redeem_link_code`, `owner_bot_owner_clubs`), 191 (`owner_bot_link_throttle`, `owner_bot_redeem_link_code_limited`) and 192 (`owner_bot_pending_actions` and the acting-as-owner wrappers `owner_bot_open_day`, `owner_bot_pending`, `owner_bot_choose`, `owner_bot_confirm`, `owner_bot_undo`) |
| Linking in the app | Settings → Telegram (owners only), shown when `NEXT_PUBLIC_TELEGRAM_OWNER_BOT_USERNAME` is set |

## Configuration

Set these only in Vercel (Production), never in the repository. The owner
creates the bot in BotFather and enters the values himself; agents never type
or print them.

- `TELEGRAM_OWNER_BOT_TOKEN`: the token BotFather gives for the owner bot (not
  `TELEGRAM_BOT_TOKEN`, the club-group bot).
- `TELEGRAM_OWNER_BOT_WEBHOOK_SECRET`: a random string of 16 to 256 characters
  from `A–Z`, `a–z`, `0–9`, `_` and `-` (for example
  `openssl rand -hex 32`). Telegram sends it back in the
  `X-Telegram-Bot-Api-Secret-Token` header of every webhook call.
- `NEXT_PUBLIC_TELEGRAM_OWNER_BOT_USERNAME`: the bot's username without `@`;
  it shows the Settings card. A build-time value, so redeploy after setting it.

`SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` are already set for
the app. Redeploy after changing any of them.

## Registering the webhook (once, and after the URL or secret changes)

On the owner's Mac, with the two values in the shell environment or in
`.env.local` (the script reads only these two names from it):

```bash
npm run owner-bot:webhook -- set
npm run owner-bot:webhook -- info
```

`set` calls `setWebhook` with the production URL
`https://admin.pixelgaming.uz/api/telegram/owner-bot`, the secret as
`secret_token` and `allowed_updates` `message` and `callback_query`; `--url
<https url>` registers another address and `--drop-pending` discards updates
Telegram is still holding. Both commands then print `getWebhookInfo` (URL,
pending updates, allowed updates, last error). The token and secret are never
printed; Telegram's answers are shown with them blanked out. Deploy the app
with the secret first, otherwise Telegram's first calls get 503 and it keeps
retrying them until the deploy is live.

## What the webhook does

- `503` while `TELEGRAM_OWNER_BOT_WEBHOOK_SECRET` is missing or malformed, or
  the bot token or service-role environment is missing. Telegram retries.
- `401` when the header does not match the secret (compared in constant time).
  Nothing is read.
- `200` for every other update, including ones it ignores and ones whose reply
  failed, so Telegram never resends an update forever. Failures are logged
  without the token.
- Text messages in a private chat with a person, and presses of the bot's
  buttons, are answered. Group, supergroup and channel messages, bots and
  edited messages are ignored. A press whose message is not the presser's own
  private chat with the bot is answered "🚫 Нет доступа." and never acted on.

Commands (replies in Russian, an emoji at the start of every line, money as
`1 200 000 сум`):

| Command | Reply |
|---|---|
| `/start` | Greeting; how to link when the account is not linked. `/start <code>` (the deep link `t.me/<bot>?start=<code>`) redeems the code like `/link`. |
| `/link <code>` | Redeems a Settings code through `owner_bot_redeem_link_code_limited` and answers per status: linked, no such code, already used, expired, not an owner, Telegram linked to another user, too many wrong codes. |
| `/clubs` | The active clubs the linked user owns, or that there are none. |
| `/today` | One message per owned club for its last closed business day (`previousClubBusinessDateIso` with the club's start hour, the day the 08:00 report covers), with buttons (below). Each Game Club method of the report's "Оплаты за день" section (`calculateGameClubDayByPaymentMethod` + `selectDayPaymentMethods`), plus any other method the till still holds or that is marked, is one line: what is still in the till (`get_collection_balances`, through `owner_bot_open_day`), the day's figure in brackets when it differs, and its state (`⏳ не отмечено`, `👌 в кассе ничего нет`, `✅ забрал`, `🏦 в резерве`). Then the bar's sales and `👛 Осталось у администратора` (the till of every method). Every read is filtered by that club's id. A club that cannot be read gets a short notice; the others still get theirs. |
| anything else | The command list, or how to link. |

An unlinked Telegram account gets "link from Settings → Telegram" for every
command except `/start` and `/link`.

## Buttons (slice 3)

Game Club methods only; the bar line has no buttons yet.

1. A method's button (`v1:menu:<line id>`) swaps the keyboard for
   `[✅ Забрал] [🏦 В резерв] / [⬅️ Назад]` and asks what happened to the money.
2. ✅ Забрал or 🏦 В резерв (`owner_bot_choose`) fixes what is in the till now
   as the amount and asks `[✅ Да] [✖️ Нет]`. Nothing is saved yet.
3. ✅ Да (`owner_bot_confirm`): ✅ Забрал is `collect_money` (Reports →
   Collected); 🏦 В резерв is `collect_money` then `move_collected_to_reserve`
   in one transaction (a Reserve deposit from collected money). Both carry the
   comment `Telegram`. The toast confirms it, the line shows the mark, and
   `[↩️ Отменить: …]` appears for 10 minutes.
4. ↩️ Отменить (`owner_bot_undo`, only for the owner who made the mark):
   `delete_owner_reserve_entry`, then `delete_money_collection`.

Each wrapper (192, service role only) finds the user linked to the presser's
Telegram id, checks that user owns the club and the club is active, and makes
that user the transaction's `auth.uid()` (`request.jwt.claim.sub` and
`request.jwt.claims`, set locally) before calling the existing RPCs, so their
access checks, the till and collected-money triggers, the day lock and the
audit (`changed_by` = the owner) work as in the app. The button carries only
`v1:<action>:<row id>` (≤ 64 bytes); club, date, method and amount come from
`owner_bot_pending_actions` or `owner_money_handovers`, and ownership is
checked again on every press.

A repeated ✅ Да, a double tap or a resent update saves nothing twice: the
choice row remembers its handover and answers `already_saved` (toast as for
the save), or `already_undone` once that mark was undone ("↩️ Уже отменено").
A second choice for a method someone already marked is refused. When the save
or undo went through but the day cannot be read again, the toast still
confirms it and the message is left as it was.

Line buttons last 7 days and are renewed (at most once a day) while still
valid; an expired one answers "⌛ Кнопка устарела" and is replaced the next
time that day is drawn. Only the choice row is locked (`FOR UPDATE` in
`owner_bot_confirm`), plus one advisory lock per club, day and method; the
day redraw skips rows other presses hold (`SKIP LOCKED`) and inserts lines
with `ON CONFLICT DO NOTHING` in a fixed order, so concurrent presses cannot
deadlock.

Refusals are alerts, and the message is redrawn where it helps:

| Alert | Cause |
|---|---|
| 🚫 Нет доступа. | Not the presser's chat or button, Telegram not linked, not an owner of an active club (`owner_bot_not_linked`, `owner_bot_not_owner`, `owner_bot_forbidden`, any 42501) |
| ⌛ Кнопка устарела. Отправьте /today. | Unknown or old button data; a line row older than 7 days or a choice older than 1 hour (`owner_bot_expired`) |
| 👌 Эти деньги уже отмечены. | The method already has a mark that day (`owner_bot_already_marked`) |
| 👌 В кассе по этому способу оплаты уже ничего нет. | The till holds none of it (`owner_bot_nothing_in_till`) |
| ⚠️ В кассе уже меньше денег… | The till fell after the choice (`INSUFFICIENT_BALANCE`, 146/169) |
| ⚠️ В резерв нельзя: прибыли за месяц… меньше этой суммы. | `reserve_exceeds_available` (169); nothing is collected either |
| 🔒 Этот день закрыт… | `day_collected` (097) |
| ⚠️ Нельзя отменить: эти деньги уже потрачены, выведены или в резерве. | Undo after collected money paid for something (`COLLECTED_INSUFFICIENT`) or reserve money was used (`reserve_already_used`) |
| ⌛ Отменить можно только в течение 10 минут. Исправьте в приложении. | `owner_bot_undo_expired` |
| ⚠️ Не получилось. Попробуйте ещё раз через минуту. | Anything else; logged as `[telegram/owner-bot] button press failed` |

The bot posts nothing to the club group itself. A deposit from collected money
is announced there by the activity audit (183) like one made in the app; a
plain collection from the bot is not announced (in the app the collect route
posts that notice).

## Wrong-code limit

At most 5 wrong codes (no such code, used or expired) per Telegram account in
a 15-minute window; after that `/link` answers "too many wrong codes" until
the window ends, even for a right code. The count is kept in
`owner_bot_link_throttle` (191), not in memory: the webhook runs as serverless
functions, where a memory counter resets on every cold start and is not shared
between instances. Codes are 8 characters from 32 (about 10^12 values) and live
15 minutes, so the limit is defence in depth. There is no fallback to the
unthrottled 190 function: without 191, `/link` fails instead.

## Checking it

- `npm run owner-bot:webhook -- info`: the URL is the production one and
  `last error` is empty after a message.
- In Telegram, send `/start` to the bot: an unlinked account is told to link in
  Settings → Telegram. Link with a fresh code, then send `/clubs` and `/today`.
- Press a method, ✅ Забрал, ✅ Да: Reports → Collected shows the collection
  with the comment `Telegram`; ↩️ Отменить removes it again. 🏦 В резерв shows
  as a Reserve deposit from collected money.
- Vercel function logs for `/api/telegram/owner-bot` show
  `[telegram/owner-bot]` lines for failures only.
