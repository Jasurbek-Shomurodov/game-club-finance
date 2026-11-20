-- Send the Google Maps "AI bot" image in the same Telegram album as the daily
-- finance report instead of as a separate message.
--
-- The review-reply job moves to 02:50 UTC (07:50 Tashkent), ten minutes before
-- the daily report (03:00 UTC since 073). When that club's report for its last
-- closed business day has not gone out yet, the run saves its digest with
-- awaiting_report = true and sends nothing; the report run adds the image to
-- its album and then records the digest as sent. A run after the report has
-- already gone out sends the image on its own, as before. Re-runnable; the
-- schedule change is skipped where pg_cron is not installed.

alter table public.google_review_digests
  add column if not exists awaiting_report boolean not null default false;

comment on column public.google_review_digests.awaiting_report is
  'True while the digest waits to be sent inside the club''s daily finance report album.';

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
          '50 2 * * *',
          'select public.invoke_game_club_google_review_replies();';
end;
$$;
