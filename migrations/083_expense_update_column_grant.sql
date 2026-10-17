-- Expenses are append-only for app users: the only update the app makes is
-- saving the Telegram message coordinates after a notification is sent
-- (POST /api/expenses). The `club_admin_update_expenses` policy from 033 lets
-- any admin rewrite amount, date, category or payment method on any row through
-- PostgREST, bypassing the route's validation and the owner-only delete rule.
-- Narrow the table privilege to the two coordinate columns; salary RPCs are
-- security definer and keep their own path. Re-runnable.

revoke update on table public.expenses from authenticated;
grant update (telegram_chat_id, telegram_message_id) on table public.expenses to authenticated;
