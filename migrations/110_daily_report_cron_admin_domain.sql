-- Point the daily Telegram finance report at the admin domain. The
-- game-club-finance.vercel.app address is being detached from the Vercel
-- project, so the cron must call https://admin.pixelgaming.uz instead.
-- Same body as 041 apart from the URL; the 073 schedule is unchanged.
create or replace function public.invoke_game_club_daily_finance_report()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'game_club_daily_report_cron_secret'
  order by created_at desc
  limit 1;

  if nullif(btrim(cron_secret), '') is null then
    raise exception 'Missing Vault secret: game_club_daily_report_cron_secret';
  end if;

  select net.http_get(
    url := 'https://admin.pixelgaming.uz/api/cron/daily-finance-report',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Accept', 'application/json',
      'User-Agent', 'Game-Club-Supabase-Cron/1.0'
    ),
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_game_club_daily_finance_report()
  from public, anon, authenticated;
