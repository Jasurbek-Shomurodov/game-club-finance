-- Internet payment reminder. Re-runnable.
--
-- Each club may set the day of the month its internet bill is due (1-31, null
-- means no reminder). The daily Telegram report sent the day before that date
-- carries a reminder line; a day past the end of a short month falls on the
-- month's last day. Owners edit it through the existing owners_update_clubs
-- policy, like business_day_start_hour.

alter table public.clubs
  add column if not exists internet_payment_day smallint;

alter table public.clubs
  drop constraint if exists clubs_internet_payment_day_range;

alter table public.clubs
  add constraint clubs_internet_payment_day_range
  check (internet_payment_day is null or internet_payment_day between 1 and 31);
