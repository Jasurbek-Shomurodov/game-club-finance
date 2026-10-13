-- Move the daily Telegram finance report from 06:00 to 08:00 Asia/Tashkent.
-- pg_cron uses UTC. 03:00 UTC is 08:00 in Asia/Tashkent (UTC+05:00).
-- The job still invokes public.invoke_game_club_daily_finance_report() from 041.
do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'game-club-daily-finance-report'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'game-club-daily-finance-report',
    '0 3 * * *',
    'select public.invoke_game_club_daily_finance_report();'
  );
end;
$$;
