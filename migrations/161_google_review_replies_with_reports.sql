-- Run the Google review replies at the same time as the daily finance report.
--
-- 152 scheduled game-club-google-review-replies at 05:00 UTC (10:00 Tashkent).
-- Move it to 03:00 UTC (08:00 Tashkent), the daily report's schedule since
-- 073, so each club's Telegram group gets both images together each morning.
-- The two jobs call separate routes and share no state, so running them at
-- once is safe. Re-runnable; skipped where pg_cron is not installed.

do $$
declare
  existing_job_id bigint;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  for existing_job_id in
    execute 'select jobid from cron.job where jobname = ''game-club-google-review-replies'''
  loop
    execute 'select cron.unschedule($1)' using existing_job_id;
  end loop;

  execute 'select cron.schedule($1, $2, $3)'
    using 'game-club-google-review-replies',
          '0 3 * * *',
          'select public.invoke_game_club_google_review_replies();';
end;
$$;
