# Owner money bot: confirm where each day's money went

Status: approved 28 Nov 2026 (decisions at the end). Building slice by slice.

## Goal and user flow

Every morning after the 08:00 report, the owner gets one private Telegram
message per club for the business date the report covered. Each payment type
(cash, terminal, card, PlayStation, bar) is one line with its amount and its
state. With two or three taps per line the owner says what happened to that
money:

- **✅ Забрал** (collected): the money left the admin's till and is with the owner
  as collected money. Same as Reports → Collected today.
- **🏦 В резерв**: the money went into the owner reserve.
- **👤 Себе**: the owner took it as profit (an owner withdrawal).
- **✏️ Другая сумма**: any of the above for part of the amount; the bot asks for
  the number with a reply prompt.

The message edits itself in place as lines are marked, so the chat never fills
with noise. Every action is the same record the app makes, so Reports, Owner
Profit, Reserve, History and the "where the money is" caption all agree.

## Mock layout

Morning message (one per club, private chat with the owner):

```
🏢 Square · 27 ноября 2026
💵 Наличные: 1 200 000 сум · ⏳ не отмечено
💳 Терминал: 800 000 сум · ⏳ не отмечено
🏧 Карта: 300 000 сум · ✅ забрал
🎮 PlayStation: 150 000 сум · 🏦 в резерве
🍺 Бар: 450 000 сум · ⏳ не отмечено
👛 Осталось у администратора: 2 450 000 сум

[ 💵 Наличные ] [ 💳 Терминал ]
[ 🍺 Бар ]
[ ✅ Всё забрал ] [ 🏦 Всё в резерв ]
```

Only unmarked lines keep a button. Tapping one swaps the keyboard (same message):

```
💵 Наличные: 1 200 000 сум
[ ✅ Забрал ] [ 🏦 В резерв ] [ 👤 Себе ]
[ ✏️ Другая сумма ] [ ⬅️ Назад ]
```

Confirmation (keyboard again, nothing saved yet):

```
🏦 Переместить 1 200 000 сум наличных Square в резерв?
[ ✅ Да ] [ ✖️ Нет ]
```

After saving, the line changes to `🏦 в резерве` and a toast confirms it. The
last action gets an undo button for 10 minutes:

```
[ ↩️ Отменить: наличные в резерв ]
```

Bar has no till or collected money in the app, so its submenu is only
`🏦 В резерв`, `👤 Себе` and `👌 Оставил в баре` (just marks it seen).

Commands: `/today` resends today's messages for all clubs, `/clubs` lists the
clubs this owner can act on, `/link <code>` connects the Telegram account.

## Placement

- Bot: a new webhook route `src/app/api/telegram/owner-bot/route.ts` and logic in
  `src/lib/telegram/ownerBot/` (pure keyboard/text builders + a thin handler).
- App: one "Telegram" row in `/settings` (owners) to link the account with a
  one-time code. No new page. Everything the bot writes is already shown on
  Reports (collected), Reserve and Owner Profit.

## Architecture

- **Separate bot** (recommended): its own token, private chats only, so admins
  in the club groups can never see or press these buttons. The owner creates it
  in BotFather and puts `TELEGRAM_OWNER_BOT_TOKEN` and
  `TELEGRAM_OWNER_BOT_WEBHOOK_SECRET` into Vercel himself. Alternative: reuse
  the current bot in a DM; cheaper, but one token for both jobs.
- **Webhook**: Telegram calls the route; it checks the
  `X-Telegram-Bot-Api-Secret-Token` header, then accepts only Telegram user ids
  linked to an app user.
- **Acting as the owner**: every existing money RPC (`collect_money`,
  `move_collected_to_reserve`, `move_owner_profit_to_reserve`,
  `withdraw_owner_game_club_money_by_method`, deletes) checks `auth.uid()` is an
  owner of the club. The bot calls new service-role-only wrappers
  `owner_bot_act(p_telegram_user_id, p_club_id, ...)` that look up the linked
  user, check the owner role for that club, set the request's JWT `sub` to that
  user for the transaction, and call the existing RPC. RLS, caps, balance
  triggers and audit (`changed_by`) work unchanged; no RPC is weakened.
- **Trigger**: after `sendDailyFinanceReport` delivers a club's report, it also
  sends the owner message (failure never affects the report). Idempotent per
  club, date and owner.
- **Clubs**: taken from the linked owner's memberships, not from the
  `TELEGRAM_<TARGET>` env list, so a new club shows up with no config.
- Callback data stays under Telegram's 64 bytes: `v1:<action>:<handover id>`;
  all detail lives in the database row.

## Data model (one new migration, additive only)

- `owner_telegram_links`: user_id, telegram_user_id (unique), linked_at; plus
  one-time link codes with expiry. Owner reads/deletes own row.
- `owner_money_handovers`: club_id, business_date, side (`game_club`/`bar`),
  payment_method, amount, action (`collected`/`reserve`/`withdrawn`/`left`),
  request id of the ledger row it made, telegram message id, created_by,
  undone_at. Insert-only for the bot; owners read. The money itself lives in the
  existing ledgers; this table only remembers which button made which row, for
  the message state and for undo.
- Service-role-only wrapper RPCs as above.

## Mapping to the existing money

| Button | Game Club (cash, terminal, card, PlayStation) | Bar |
|---|---|---|
| ✅ Забрал | `collect_money` | not offered |
| 🏦 В резерв | `collect_money` then `move_collected_to_reserve`, one transaction | `move_owner_profit_to_reserve` source bar |
| 👤 Себе | `collect_money` then an owner withdrawal (see open question 2) | owner withdrawal source bar |
| ↩️ Отменить | `delete_owner_reserve_entry` / `delete_money_collection` | delete of the reserve entry or withdrawal |

Default amount: what is still in the till for that method on that date
(`get_collection_balances`), not the day's gross income, because expenses paid
from the till have already taken part of it. The message shows both when they
differ. Undo is refused, with a clear message, when the money was already spent
(the existing delete RPCs already refuse that). Collected days (`day_collected`
lock) are respected as today.

Append-only ledgers (debts, payments, saved stock counts) are not touched.

## Tests

- Unit: text and keyboard builders (Russian, emoji first, `1 000 000` format),
  callback parsing, state from handovers, amount defaults.
- Route: secret header, unknown user refused, double tap is idempotent.
- Migration: wrapper refuses a non-owner and a non-linked Telegram id.
- No e2e change except the Settings link row.

## Slices

1. Migration: link table, handovers table, wrapper RPCs; Settings "Link Telegram"
   row (uz/ru/en).
2. Webhook route + `/link`, `/clubs`, `/today` with a read-only message (no
   buttons yet).
3. Buttons for Game Club methods: collect, reserve, confirm, undo.
4. Bar line, "Другая сумма", "Всё забрал / Всё в резерв".
5. Morning send right after the report; optional evening reminder for unmarked
   lines.

## Decisions (owner, 28 Nov 2026)

1. A separate bot. The owner creates it in BotFather and enters
   `TELEGRAM_OWNER_BOT_TOKEN` and `TELEGRAM_OWNER_BOT_WEBHOOK_SECRET` in Vercel
   himself.
2. First ship ✅ Забрал and 🏦 В резерв only. 👤 Себе (owner withdrawal that also
   leaves collected money) is a later slice of its own, because it changes the
   till/collected balance function.
3. Every owner of a club gets the buttons for that club; each linked owner sees
   only the clubs they own.
4. Terminal and card are included; ✅ for them means it reached the account.

## Slice 1 detail

Migration `190_owner_telegram_bot.sql` (additive only):

- `owner_telegram_links (user_id uuid pk references auth.users, telegram_user_id bigint unique not null, telegram_username text, linked_at timestamptz)`.
  RLS: a user selects and deletes only their own row; no client insert/update.
- `owner_telegram_link_codes (code text pk, user_id, expires_at, used_at)`: a
  6–8 character one-time code, 15 minutes. RPC `create_owner_telegram_link_code()`
  (authenticated; caller must own at least one club, `current_user_owns_any_club()`),
  returns the code; replaces the caller's unused codes.
- RPC `owner_bot_redeem_link_code(p_code, p_telegram_user_id, p_username)`:
  service role only; marks the code used, upserts the link (one Telegram id ↔ one
  user), refuses expired/used codes.
- `owner_money_handovers` table as in the Data model section, `request_id uuid`
  unique per club, RLS: owners of the club select; no client writes.
- RPC `owner_bot_owner_clubs(p_telegram_user_id)`: service role only; the clubs
  the linked user owns (id, name).
- Audit: add `record_activity_audit` to `owner_money_handovers` (database.md says
  every new ledger gets it).
- Regenerate the migrations manifest; update `docs/agents/database.md`.

App: on `/settings`, an owner-only "Telegram" card: not linked → button "Get
link code" showing the code and the instruction `/link <code>` to the bot (bot
username from `NEXT_PUBLIC_TELEGRAM_OWNER_BOT_USERNAME`, hidden when unset);
linked → shows @username and an "Unlink" button (deletes own link through RLS,
confirmed with `useConfirm`). uz/ru/en copy, skeleton updated.

The acting-as-owner wrappers (`owner_bot_act…`) come with slice 3, where they
are first used.

## Slice 2 detail

Webhook `src/app/api/telegram/owner-bot/route.ts` with `/start` (and the
`/start <code>` deep link), `/link`, `/clubs` and a read-only `/today`; logic in
`src/lib/telegram/ownerBot/`. Operating it: `docs/runbooks/owner-money-bot.md`
(including `npm run owner-bot:webhook -- set`). `/today` shows the report's
"Оплаты за день" figures and the bar's sales for the club's last closed
business day; the till balance (`get_collection_balances`) arrives with the
buttons in slice 3. Wrong `/link` codes are limited per Telegram account in the
database (migration `191_owner_bot_link_throttle.sql`, additive), because a
counter in memory does not survive serverless cold starts.

## Slice 3 detail

Game Club methods only (cash, terminal, card, PlayStation): ✅ Забрал and
🏦 В резерв, a confirmation, and undo for 10 minutes. 👤 Себе waits for its own
slice (decision 2); the bar line stays read-only, and "Другая сумма" / "Всё…"
come with slice 4.

- `/today` sends one message per owned club with a keyboard: a button for every
  method with money still in the till and no mark. A line reads
  `💵 Наличные: 1 000 000 сум (за день 1 200 000 сум) · ⏳ не отмечено`: the
  amount is what `get_collection_balances` says is still in the till for that
  method on that business date (whole sums), the day's report figure in
  brackets only when it differs. A till of 0 shows `👌 в кассе ничего нет` and
  no button; a marked line shows `✅ забрал` / `🏦 в резерве` with what was
  marked. The footer `👛 Осталось у администратора` is the till of all
  methods. A method outside the report's list still shows when the till holds
  it or it is marked.
- Tap a method → the same message gets `👉 … Что сделали с этими деньгами?` and
  `[✅ Забрал] [🏦 В резерв] / [⬅️ Назад]` → a choice fixes the amount in the
  till at that moment → `[✅ Да] [✖️ Нет]` → saved, toast
  (`answerCallbackQuery`), the message is redrawn with the mark and
  `[↩️ Отменить: наличные в резерв]` (the presser's own last mark, while its 10
  minutes last). Refusals are alerts and the day is redrawn, so a question that
  no longer holds does not stay on screen.
- Callback data is `v1:<menu|collect|reserve|back|yes|no|undo>:<uuid>` (at most
  47 bytes). The uuid is a row of `owner_bot_pending_actions` or, for undo, of
  `owner_money_handovers`; club, date, method and amount always come from the
  database.
- Migration `192_owner_bot_actions.sql` (additive): `owner_bot_pending_actions`
  (line rows per Telegram account, club, date and method, 7 days; choice rows
  with action, amount and request id, 1 hour; service role only, no policies)
  and service-role-only wrappers `owner_bot_open_day`, `owner_bot_pending`,
  `owner_bot_choose`, `owner_bot_confirm`, `owner_bot_undo`. Each resolves the
  linked user, checks the owner role on an active club, sets
  `request.jwt.claim.sub`, `request.jwt.claim.role` and the `sub`/`role` of
  `request.jwt.claims` with `set_config(..., true)` so `auth.uid()` is the
  owner for the rest of the transaction, and calls the existing RPCs:
  `collect_money`, then `move_collected_to_reserve` (reserve entry id = the
  collection's request id) in the same transaction; undo is
  `delete_owner_reserve_entry` then `delete_money_collection`. The handover
  row (`request_id` = the choice's) is inserted idempotently and undo sets
  `undone_at`. A second ✅ Да, or Telegram resending the update, answers
  `already_saved` (`already_undone` after an undo); two choices for the same method and day are serialised by
  an advisory lock and the second is refused as already marked. Undo is only
  for the owner who made the mark. Only the choice row is locked; the day
  redraw skips locked rows and never waits, so concurrent presses cannot
  deadlock. Line rows are refused once expired and renewed only while valid.
- Comment on the ledger rows: `Telegram`. The bot sends no club-group notice
  of its own; the collected-to-reserve deposit is announced by the activity
  audit as from the app, a plain collection is not (the app's collect route
  posts that notice itself).
