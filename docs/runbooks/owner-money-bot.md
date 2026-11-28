# Owner money bot runbook

Read this before changing or operating the owner money bot
(`docs/plans/owner-money-bot.md`): a separate Telegram bot that talks only to
club owners in private chats. It is not the club-group bot of
`docs/runbooks/telegram-report.md` and never posts to a group.

## Pieces

| Piece | Where |
|---|---|
| Webhook | `src/app/api/telegram/owner-bot/route.ts` (`POST`) |
| Logic | `src/lib/telegram/ownerBot/`: `update.ts` (which updates count), `commands.ts`, `handler.ts`, `day.ts` (the `/today` figures), `texts.ts` (Russian replies), `webhookAuth.ts`, `webhookSetup.ts` |
| Database | Migration 190 (links, one-time codes, handovers, `owner_bot_redeem_link_code`, `owner_bot_owner_clubs`) and 191 (`owner_bot_link_throttle`, `owner_bot_redeem_link_code_limited`) |
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
- Only text messages in a private chat with a person are answered. Group,
  supergroup and channel messages, bots, edited messages and button presses
  (none exist yet) are ignored.

Commands (replies in Russian, an emoji at the start of every line, money as
`1 200 000 сум`):

| Command | Reply |
|---|---|
| `/start` | Greeting; how to link when the account is not linked. `/start <code>` (the deep link `t.me/<bot>?start=<code>`) redeems the code like `/link`. |
| `/link <code>` | Redeems a Settings code through `owner_bot_redeem_link_code_limited` and answers per status: linked, no such code, already used, expired, not an owner, Telegram linked to another user, too many wrong codes. |
| `/clubs` | The active clubs the linked user owns, or that there are none. |
| `/today` | One read-only message per owned club for its last closed business day (`previousClubBusinessDateIso` with the club's start hour, the day the 08:00 report covers): Game Club money per method as the report's "Оплаты за день" section shows it (`calculateGameClubDayByPaymentMethod` + `selectDayPaymentMethods`: the enabled methods, PlayStation only when it moved money, net with income and expenses when something was paid from it) and the bar's sales. Every read is filtered by that club's id. A club that cannot be read gets a short notice; the others still get theirs. |
| anything else | The command list, or how to link. |

An unlinked Telegram account gets "link from Settings → Telegram" for every
command except `/start` and `/link`.

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
- Vercel function logs for `/api/telegram/owner-bot` show
  `[telegram/owner-bot]` lines for failures only.
