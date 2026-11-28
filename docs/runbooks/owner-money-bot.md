# Owner money bot runbook

Read this before changing or operating the owner money bot
(`docs/plans/owner-money-bot.md`): a separate Telegram bot that talks only to
club owners in private chats. It is not the club-group bot of
`docs/runbooks/telegram-report.md` and never posts to a group.

## Pieces

| Piece | Where |
|---|---|
| Webhook | `src/app/api/telegram/owner-bot/route.ts` (`POST`) |
| Logic | `src/lib/telegram/ownerBot/`: `update.ts` (which updates count), `commands.ts`, `handler.ts` (messages, typed amounts), `callbacks.ts` (button presses), `callbackData.ts` (`v1:<action>:<id>`), `actions.ts` (the 192/193 wrappers and their refusals), `amount.ts` (reading a typed sum), `day.ts` (the day's figures), `dayView.ts` (lines, bar, states, undo), `keyboard.ts`, `texts.ts` (Russian replies), `outgoing.ts` (sending replies and ForceReply questions), `morning.ts` (the morning message), `telegramApi.ts` (`answerCallbackQuery`, `editMessageText`), `webhookAuth.ts`, `webhookSetup.ts` |
| Morning send | `src/app/api/cron/daily-finance-report/route.ts` calls `sendOwnerBotMorningMessages` after a club's scheduled report is delivered |
| Database | Migration 190 (links, one-time codes, handovers, `owner_bot_redeem_link_code`, `owner_bot_owner_clubs`), 191 (`owner_bot_link_throttle`, `owner_bot_redeem_link_code_limited`), 192 (`owner_bot_pending_actions` and the acting-as-owner wrappers `owner_bot_open_day`, `owner_bot_pending`, `owner_bot_choose`, `owner_bot_confirm`, `owner_bot_undo`) and 193 (`owner_money_handovers.group_id`, `owner_bot_steps`, `owner_bot_day_messages` and `owner_bot_today`, `owner_bot_button`, `owner_bot_pick`, `owner_bot_ask_amount`, `owner_bot_prompt_sent`, `owner_bot_answer_amount`, `owner_bot_confirm_any`, `owner_bot_undo_any`, plus the morning functions). The webhook calls only the 193 wrappers; they call the 192 ones for one Game Club method |
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
  buttons, are answered. A text that replies to one of the bot's messages
  (and is not a command) is the answer to a ✏️ Другая сумма question. Group, supergroup and channel messages, bots and
  edited messages are ignored. A press whose message is not the presser's own
  private chat with the bot is answered "🚫 Нет доступа." and never acted on.

Commands (replies in Russian, an emoji at the start of every line, money as
`1 200 000 сум`):

| Command | Reply |
|---|---|
| `/start` | Greeting; how to link when the account is not linked. `/start <code>` (the deep link `t.me/<bot>?start=<code>`) redeems the code like `/link`. |
| `/link <code>` | Redeems a Settings code through `owner_bot_redeem_link_code_limited` and answers per status: linked, no such code, already used, expired, not an owner, Telegram linked to another user, too many wrong codes. |
| `/clubs` | The active clubs the linked user owns, or that there are none. |
| `/today` | One message per owned club for its last closed business day (`previousClubBusinessDateIso` with the club's start hour, the day the 08:00 report covers), with buttons (below). Each Game Club method of the report's "Оплаты за день" section (`calculateGameClubDayByPaymentMethod` + `selectDayPaymentMethods`), plus any other method the till still holds or that is marked, is one line: what is still in the till (`get_collection_balances`, through `owner_bot_open_day`), the day's figure in brackets when it differs, and its state (`⏳ не отмечено`, `👌 в кассе ничего нет`, `✅ забрал`, `🏦 в резерве`). Then the bar line (`🍺 Бар (продажи): …` with its state: `⏳ не отмечено`, `🏦 в резерве`, `👌 оставил в баре`, and what was moved when it differs from the sales) and `👛 Осталось у администратора` (the till of every method). Every read is filtered by that club's id. A club that cannot be read gets a short notice; the others still get theirs. |
| anything else | The command list, or how to link. |

An unlinked Telegram account gets "link from Settings → Telegram" for every
command except `/start` and `/link`.

## Buttons (slices 3 and 4)

The day message's keyboard: a button per Game Club method with money in the
till and no mark (two per row), `[🍺 Бар]` while the bar sold something and is
not marked, `[✅ Всё забрал] [🏦 Всё в резерв]` while two or more methods are
open (with one, its own button does the same), and the undo of the presser's
own last mark while its 10 minutes last. 👤 Себе is not offered yet (decision 2).

1. A method's button (`v1:menu:<line id>`) swaps the keyboard for
   `[✅ Забрал] [🏦 В резерв] / [✏️ Другая сумма] [⬅️ Назад]` and asks what
   happened to the money.
2. ✅ Забрал or 🏦 В резерв (`owner_bot_pick`, which calls 192's
   `owner_bot_choose`) fixes what is in the till now as the amount and asks
   `[✅ Да] [✖️ Нет]`. Nothing is saved yet.
3. ✅ Да (`owner_bot_confirm_any` → `owner_bot_confirm`): ✅ Забрал is
   `collect_money` (Reports → Collected); 🏦 В резерв is `collect_money` then
   `move_collected_to_reserve` in one transaction (a Reserve deposit from
   collected money). Both carry the comment `Telegram`. The toast confirms it,
   the line shows the mark, and `[↩️ Отменить: …]` appears for 10 minutes.
4. ↩️ Отменить (`owner_bot_undo_any`, only for the owner who made the mark):
   `delete_owner_reserve_entry`, then `delete_money_collection`.

The bar (`v1:menu:<day id>`): `[🏦 В резерв] [👌 Оставил в баре] / [✏️ Другая
сумма] [⬅️ Назад]`. Bar money has no till, so nothing is "collected".

- 🏦 В резерв is `move_owner_profit_to_reserve` with source `bar`, the month
  of the business date and that date as the entry's day (comment `Telegram`).
  The amount is the day's bar sales, but never more than the month's bar
  profit allows (`owner_profit_bucket_available`: the month's bar sales less
  stock purchases, bar expenses, withdrawals and earlier deposits); the
  confirmation says when it was capped. When nothing is allowed, the alert says
  so and nothing is chosen.
- 👌 Оставил в баре only marks the day's sales as left in the bar (no ledger row).
- ↩️ Отменить: the bar reserve entry is deleted (`delete_owner_reserve_entry`,
  refused once the reserve money was used); "left" just gets `undone_at`.

✏️ Другая сумма:

1. On a method: `[✅ Забрал] [🏦 В резерв] / [⬅️ Назад]` (what the part is
   for); on the bar it is always the reserve.
2. The bot sends a new message with ForceReply: `✏️ Square · 💵 Наличные:
   сколько забрали? 👇 Ответьте на это сообщение суммой до …` (the most it may
   be: what the default would be now). The question is a row of
   `owner_bot_steps` (`owner_bot_ask_amount`), its message id recorded by
   `owner_bot_prompt_sent`, valid for 1 hour.
3. The owner's reply is matched by the message it replies to and the sender's
   Telegram account (`owner_bot_answer_amount`), never by the text alone. Digits
   with spaces, dots or commas between thousands and an optional `сум` are read
   as a whole sum (`amount.ts`). Not a sum, 0, or more than allowed: the question
   is sent again with the reason. A good sum becomes the usual choice, and the
   confirmation `[✅ Да] [✖️ Нет]` is sent below the answer; the day message it
   was asked from keeps its text and loses its buttons.
4. After that, ✅ Да and ↩️ Отменить work as above. A method marked with part of
   its money counts as marked; the rest stays in the till (and in
   `👛 Осталось у администратора`).

✅ Всё забрал / 🏦 Всё в резерв (`v1:allcollect|allreserve:<day id>`): one
confirmation lists every Game Club method with money in the till and no mark,
each with its amount, and the total. ✅ Да is one transaction: per method
`collect_money` (and `move_collected_to_reserve`) with its own request id, one
handover per method sharing `group_id`, all or nothing (one refused reserve,
or a method someone marked meanwhile, saves none of them). One
`[↩️ Отменить: всё забрал / всё в резерв]` undoes the whole group.

Each wrapper (192, 193; service role only) finds the user linked to the
presser's Telegram id, checks that user owns the club and the club is active,
and makes that user the transaction's `auth.uid()` (`request.jwt.claim.sub`
and `request.jwt.claims`, set locally) before calling the existing RPCs, so
their access checks, the till and collected-money triggers, the day lock and
the audit (`changed_by` = the owner) work as in the app. The button carries
only `v1:<action>:<row id>` (≤ 64 bytes); club, date, method and amount come
from `owner_bot_pending_actions`, `owner_bot_steps` or
`owner_money_handovers`, and ownership is checked again on every press.

A repeated ✅ Да, a double tap or a resent update saves nothing twice: the
choice row remembers its handover and answers `already_saved` (toast as for
the save), or `already_undone` once that mark was undone ("↩️ Уже отменено").
A second choice for money someone already marked is refused. When the save
or undo went through but the day cannot be read again, the toast still
confirms it and the message is left as it was.

Line and day buttons last 7 days and are renewed (at most once a day) while
still valid. ✖️ Нет, ⬅️ Назад and a refused press read the button's row even
when it has expired (`owner_bot_button`), so the day is redrawn with fresh
buttons instead of leaving an old question on screen; a button whose row is
gone answers "⌛ Кнопка устарела". Only choice and question rows are locked
(`FOR UPDATE` in the confirm and the answer), plus one advisory lock per club,
day and method (the bar has its own; "Всё…" takes its methods' locks in a fixed
order). A Game Club reserve confirmation first takes the reserve bucket lock of
the month (the key `move_collected_to_reserve` uses), before the mark locks and
before `collect_money` takes the method-balance lock: the same order an undo
(`delete_owner_reserve_entry`, then `delete_money_collection`) takes them in.
The day redraw skips rows other presses hold (`SKIP LOCKED`) and
inserts with `ON CONFLICT DO NOTHING`, so concurrent presses cannot deadlock.

Refusals are alerts, and the message is redrawn where it helps:

| Alert | Cause |
|---|---|
| 🚫 Нет доступа. | Not the presser's chat or button, Telegram not linked, not an owner of an active club (`owner_bot_not_linked`, `owner_bot_not_owner`, `owner_bot_forbidden`, any 42501) |
| ⌛ Кнопка устарела. Отправьте /today. | Unknown or old button data; a line or day row older than 7 days or a choice older than 1 hour (`owner_bot_expired`); the day is redrawn when its row still exists |
| 👌 Эти деньги уже отмечены. | The method or the bar already has a mark that day (`owner_bot_already_marked`) |
| 👌 В кассе по этому способу оплаты уже ничего нет. | The till holds none of it, or nothing at all for "Всё…" (`owner_bot_nothing_in_till`) |
| 👌 В баре за этот день продаж нет. | `owner_bot_nothing_in_bar` |
| ⚠️ В резерв нельзя: прибыль бара за месяц уже выведена или в резерве. | `owner_bot_bar_reserve_unavailable` |
| ⚠️ В кассе уже меньше денег… | The till fell after the choice (`INSUFFICIENT_BALANCE`, 146/169) |
| ⚠️ В резерв нельзя: прибыли за месяц… меньше этой суммы. | `reserve_exceeds_available` (162, 169); nothing is collected either |
| 🔒 Этот день закрыт… | `day_collected` (097) |
| ⚠️ Нельзя отменить: эти деньги уже потрачены, выведены или в резерве. | Undo after collected money paid for something (`COLLECTED_INSUFFICIENT`) or reserve money was used (`reserve_already_used`) |
| ⌛ Отменить можно только в течение 10 минут. Исправьте в приложении. | `owner_bot_undo_expired` |
| ⚠️ Не получилось. Попробуйте ещё раз через минуту. | Anything else; logged as `[telegram/owner-bot] button press failed` |

A reply that looks like a sum but answers no open question (answered, older
than an hour, or not a question) gets "⌛ Этот вопрос о сумме уже не действует.
Отправьте /today."; any other reply is answered like a plain message.

The bot posts nothing to the club group itself. A reserve deposit (from
collected money or from bar profit) is announced there by the activity audit
(183) like one made in the app; a plain collection from the bot is not
announced (in the app the collect route posts that notice).

## Morning message (slice 5)

Right after the daily report cron (`/api/cron/daily-finance-report`, also its
retry aliases) delivers a club's **scheduled** report for its last closed
business day (`previousClubBusinessDateIso` with the club's start hour) and
records it, every
owner of that club who linked Telegram gets the same message `/today` sends for
that business date, with its buttons, from the owner bot
(`sendOwnerBotMorningMessages`). The recipients are
`owner_bot_club_owner_telegram_ids` (owners of the active club), not the
`TELEGRAM_<TARGET>` list.

- Once per club, business date and owner: `owner_bot_claim_day_message` is
  taken before sending and never again, and `owner_bot_finish_day_message`
  records the message id. A retry run that finds the report already sent
  sends only what is still missing. A send that definitely failed (for
  example the owner blocked the bot) gives the claim back
  (`owner_bot_release_day_message`) for a later run; an unknown outcome (a
  timeout after the request went out) keeps it, so nothing is sent twice. The
  owner can always send `/today`.
- It never affects the report or its retries: it runs after the report's
  ledger row is final, catches every error and only logs it (events
  `owner_bot_morning_*`, without the token or Telegram ids). The cron's answer
  shows `ownerBotMessages: { sent, alreadySent, failed }` per club.
- A forced resend (`force=1`), a dry run and a scheduled run for an older
  `?date=` do not send it, so owners never get live buttons for an old day. Without
  `TELEGRAM_OWNER_BOT_TOKEN` it is skipped silently (`ownerBotMessages: null`).
- No evening reminder for unmarked lines yet.

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
- 🍺 Бар → 🏦 В резерв → ✅ Да: Reserve shows a bar deposit for the business
  date with the comment `Telegram`. ✏️ Другая сумма: answer the question with
  `500 000`; the confirmation arrives below.
- After 08:00 the cron's response lists `ownerBotMessages` per club, and each
  linked owner has one morning message per club; running the retry alias again
  sends nothing new.
- Vercel function logs for `/api/telegram/owner-bot` show
  `[telegram/owner-bot]` lines for failures only.
