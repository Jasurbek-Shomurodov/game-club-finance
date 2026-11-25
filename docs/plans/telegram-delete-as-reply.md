# Telegram: a deleted entry keeps its message and gets a "removed" reply

## Goal

Today, deleting an expense, an exchange or a salary record deletes the bot's
original Telegram message for it (`deleteTelegramMessage` in
`src/app/api/expenses/route.ts`, `src/app/api/exchanges/route.ts`,
`src/app/api/salaries/route.ts`) and sends a separate "🗑 Удалено …" notice
(`sendClubNotice` in `src/lib/telegram/entryChangeNotification.ts`). The group
loses the history and the notice floats with no context.

New behaviour: never delete the original message. Send the existing deletion
notice as a **reply** to the original message, so the group sees the entry and,
threaded under it, that it was removed, by whom and why.

## Design

- `sendClubNotice` gains an optional `replyToMessageId`. When set, the message
  is sent with Telegram `reply_parameters: { message_id, allow_sending_without_reply: true }`
  so a missing/old original still gets the notice as a plain message.
  `sendTelegramMessage` gets the matching optional parameter if it lacks one.
- The three delete paths stop calling `deleteTelegramMessage` and pass the
  original's message id as `replyToMessageId` — only when the stored chat id
  equals the club's configured group (`targetChatId`), the same trust rule the
  delete used. Otherwise send the notice without a reply.
- Notice text stays as it is (all Russian, as today). Any wording that says the
  message was removed should no longer say so.
- Other deletions that send a notice but have no stored message id (activity
  notices etc.) are unchanged.
- Remove `deleteTelegramMessage` only if nothing else uses it afterwards (and its
  test with it); otherwise leave it.

## Data model

No migration.

## Tests

- Route tests for expenses, exchanges, salaries: deletion no longer calls
  `deleteTelegramMessage`; the notice is sent with the reply id when the chat
  matches, without it when the chat differs or no id is stored.
- `entryChangeNotification` / `sendTelegramMessage` tests for the reply parameter.

## Slices

1. All of the above.
