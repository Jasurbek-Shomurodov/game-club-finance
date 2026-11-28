-- Owner money bot, slice 1 (docs/plans/owner-money-bot.md): the tables and
-- service-only functions a separate Telegram bot needs to know which app user
-- is writing to it, and to remember which button made which money record.
--
--   owner_telegram_links: one app user <-> one Telegram account. A user reads
--     and deletes (unlinks) only their own row; links are created only by
--     owner_bot_redeem_link_code under the service role.
--   owner_telegram_link_codes: one-time codes (8 characters, 15 minutes) an
--     owner gets in Settings and sends to the bot as /link <code>. No browser
--     role can read them; create_owner_telegram_link_code returns the new one.
--   owner_money_handovers: what the owner told the bot happened to a day's
--     money (collected, into the reserve, taken, left in the bar), with the
--     request id of the ledger row it made and the Telegram message it belongs
--     to. The money itself stays in the existing ledgers. Owners of the club
--     read it; only the service role writes it. Audited (183).
--   create_owner_telegram_link_code(): an owner of any club gets a new code;
--     their earlier unused codes stop working.
--   owner_bot_redeem_link_code(code, telegram id, username): service role
--     only; links the Telegram account to the code's user.
--   owner_bot_owner_clubs(telegram id): service role only; the active clubs
--     the linked user owns.
--
-- Non-destructive: new tables, policies, functions and triggers only. The
-- DROP POLICY / DROP TRIGGER IF EXISTS statements remove only what this file
-- creates, so it can run again. The DELETEs inside
-- create_owner_telegram_link_code remove only one-time link codes (the
-- caller's unused ones and any expired for a day), never ledger rows.
-- Re-runnable.

create table if not exists public.owner_telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_user_id bigint not null,
  telegram_username text,
  linked_at timestamptz not null default now(),
  constraint owner_telegram_links_telegram_user unique (telegram_user_id),
  constraint owner_telegram_links_telegram_user_positive check (telegram_user_id > 0),
  constraint owner_telegram_links_username_length check (telegram_username is null or char_length(telegram_username) between 1 and 64)
);

alter table public.owner_telegram_links enable row level security;
revoke all on table public.owner_telegram_links from public, anon, authenticated;
grant select, delete on table public.owner_telegram_links to authenticated;
grant select, insert, update, delete on table public.owner_telegram_links to service_role;

drop policy if exists owner_telegram_links_own_read on public.owner_telegram_links;
create policy owner_telegram_links_own_read on public.owner_telegram_links for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists owner_telegram_links_own_delete on public.owner_telegram_links;
create policy owner_telegram_links_own_delete on public.owner_telegram_links for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.owner_telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint owner_telegram_link_codes_format check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint owner_telegram_link_codes_expiry check (expires_at > created_at)
);
create index if not exists owner_telegram_link_codes_user on public.owner_telegram_link_codes (user_id);

alter table public.owner_telegram_link_codes enable row level security;
revoke all on table public.owner_telegram_link_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.owner_telegram_link_codes to service_role;

create table if not exists public.owner_money_handovers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  business_date date not null,
  side text not null,
  payment_method text,
  amount numeric not null,
  action text not null,
  request_id uuid not null,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  constraint owner_money_handovers_side check (side in ('game_club', 'bar')),
  constraint owner_money_handovers_method check (
    (side = 'game_club' and payment_method is not null and payment_method in ('cash', 'terminal', 'card', 'playstation'))
    or (side = 'bar' and payment_method is null)
  ),
  constraint owner_money_handovers_action check (action in ('collected', 'reserve', 'withdrawn', 'left')),
  -- Bar money has no till to collect from; only bar money can be left where it is.
  constraint owner_money_handovers_action_side check (
    (action <> 'collected' or side = 'game_club') and (action <> 'left' or side = 'bar')
  ),
  -- Whole sums; only "left in the bar" may be nothing.
  constraint owner_money_handovers_amount check (amount = round(amount) and (amount > 0 or (action = 'left' and amount = 0))),
  constraint owner_money_handovers_undone check (undone_at is null or undone_at >= created_at),
  constraint owner_money_handovers_request unique (club_id, request_id)
);
create index if not exists owner_money_handovers_club_date on public.owner_money_handovers (club_id, business_date);

create index if not exists owner_money_handovers_created_by on public.owner_money_handovers (created_by);

alter table public.owner_money_handovers enable row level security;
revoke all on table public.owner_money_handovers from public, anon, authenticated;
grant select on table public.owner_money_handovers to authenticated;
grant select, insert, update on table public.owner_money_handovers to service_role;

drop policy if exists owner_money_handovers_owner_read on public.owner_money_handovers;
create policy owner_money_handovers_owner_read on public.owner_money_handovers for select to authenticated
  using (club_id in (select public.current_user_member_clubs(array['owner']::text[])));

-- Every new ledger is audited (183): its creations and its undo.
drop trigger if exists record_activity_audit on public.owner_money_handovers;
create trigger record_activity_audit after insert or update on public.owner_money_handovers
  for each row execute function public.record_activity_audit('club_id', 'id', 'undone_at');

-- An owner of any club gets a new one-time code for /link in the owner bot.
-- 8 characters from 32 that cannot be misread (no I, O, 0 or 1), drawn from
-- the fully random bytes of gen_random_uuid(); valid for 15 minutes.
create or replace function public.create_owner_telegram_link_code()
returns table(code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  random_bytes bytea;
  candidate text;
  expiry timestamptz := now() + interval '15 minutes';
  byte_index integer;
begin
  if caller is null then
    raise exception 'Sign in to link Telegram.' using errcode = '42501';
  end if;
  if not public.current_user_owns_any_club() then
    raise exception 'Only a club owner can link Telegram.' using errcode = '42501';
  end if;

  delete from public.owner_telegram_link_codes codes
  where (codes.user_id = caller and codes.used_at is null)
    or codes.expires_at < now() - interval '1 day';

  loop
    random_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    candidate := '';
    -- Bytes 6 and 8 carry the UUID version and variant bits; the rest are random.
    foreach byte_index in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
      candidate := candidate || substr(alphabet, 1 + get_byte(random_bytes, byte_index) % 32, 1);
    end loop;
    begin
      insert into public.owner_telegram_link_codes (code, user_id, expires_at)
      values (candidate, caller, expiry);
      exit;
    exception when unique_violation then
      -- Another live code has these characters; draw again.
    end;
  end loop;

  return query select candidate, expiry;
end;
$$;
revoke all on function public.create_owner_telegram_link_code() from public, anon;
grant execute on function public.create_owner_telegram_link_code() to authenticated;

-- The owner bot links the Telegram account that sent /link <code> to the
-- code's user. Answers with a status the bot turns into a reply:
--   linked           the account is linked (also for a repeated delivery of the same code)
--   invalid          no such code
--   used             the code was already used by another Telegram account
--   expired          older than 15 minutes
--   not_owner        the code's user no longer owns a club
--   telegram_in_use  this Telegram account is linked to another app user; unlink it there first
create or replace function public.owner_bot_redeem_link_code(p_code text, p_telegram_user_id bigint, p_username text default null)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  normalized text := upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'));
  username text := nullif(left(regexp_replace(btrim(coalesce(p_username, '')), '^@', ''), 64), '');
  link_code public.owner_telegram_link_codes%rowtype;
begin
  if p_telegram_user_id is null or p_telegram_user_id <= 0 then
    raise exception 'A Telegram user id is required.' using errcode = '22023';
  end if;
  if normalized !~ '^[A-HJ-NP-Z2-9]{8}$' then
    return 'invalid';
  end if;

  select * into link_code from public.owner_telegram_link_codes where code = normalized for update;
  if link_code.code is null then
    return 'invalid';
  end if;
  if link_code.used_at is not null then
    if exists (
      select 1 from public.owner_telegram_links links
      where links.user_id = link_code.user_id and links.telegram_user_id = p_telegram_user_id
    ) then
      return 'linked';
    end if;
    return 'used';
  end if;
  if link_code.expires_at <= now() then
    return 'expired';
  end if;
  if not exists (
    select 1 from public.club_memberships memberships
    join public.clubs clubs on clubs.id = memberships.club_id and clubs.is_active
    where memberships.user_id = link_code.user_id and memberships.role = 'owner'
  ) then
    return 'not_owner';
  end if;
  if exists (
    select 1 from public.owner_telegram_links links
    where links.telegram_user_id = p_telegram_user_id and links.user_id <> link_code.user_id
  ) then
    return 'telegram_in_use';
  end if;

  begin
    insert into public.owner_telegram_links (user_id, telegram_user_id, telegram_username, linked_at)
    values (link_code.user_id, p_telegram_user_id, username, now())
    on conflict (user_id) do update
      set telegram_user_id = excluded.telegram_user_id,
          telegram_username = excluded.telegram_username,
          linked_at = excluded.linked_at;
  exception when unique_violation then
    -- Another user linked this Telegram account at the same moment.
    return 'telegram_in_use';
  end;
  update public.owner_telegram_link_codes set used_at = now() where code = link_code.code;
  return 'linked';
end;
$$;
revoke all on function public.owner_bot_redeem_link_code(text, bigint, text) from public, anon, authenticated;
grant execute on function public.owner_bot_redeem_link_code(text, bigint, text) to service_role;

-- The active clubs the user linked to this Telegram account owns, by name.
create or replace function public.owner_bot_owner_clubs(p_telegram_user_id bigint)
returns table(id uuid, name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select clubs.id, clubs.name::text
  from public.owner_telegram_links links
  join public.club_memberships memberships
    on memberships.user_id = links.user_id and memberships.role = 'owner'
  join public.clubs clubs on clubs.id = memberships.club_id and clubs.is_active
  where links.telegram_user_id = p_telegram_user_id
  order by clubs.name, clubs.id
$$;
revoke all on function public.owner_bot_owner_clubs(bigint) from public, anon, authenticated;
grant execute on function public.owner_bot_owner_clubs(bigint) to service_role;
