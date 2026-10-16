-- Recreate the Supabase Cron jobs after scripts/db-restore.sh. A dump of public and
-- auth does not carry the cron schema. Run in the SQL editor of the restored project
-- AFTER the Vault secret from docs/runbooks/telegram-report.md exists.
-- Copied from the scheduling block of migration 073. The monthly average income
-- job from 042 was retired by migration 081 and must not be recreated.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

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
