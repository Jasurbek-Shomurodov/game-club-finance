-- Owners reject an access request by deleting the sign-up. That delete is
-- refused when the person was on the team before and their account is still
-- referenced by records they created (created_by foreign keys), and those
-- records must stay. Such a request is marked rejected instead, which hides it
-- from the team page while keeping the account and its history.
--
-- Granting any club access later clears the mark, so a person whose access is
-- removed again shows up as a fresh request.

alter table public.profiles
  add column if not exists access_rejected_at timestamptz,
  add column if not exists access_rejected_by uuid references auth.users(id) on delete set null;

create or replace function public.clear_profile_access_rejection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set access_rejected_at = null,
      access_rejected_by = null,
      updated_at = now()
  where id = NEW.user_id
    and access_rejected_at is not null;
  return NEW;
end;
$$;

revoke all on function public.clear_profile_access_rejection() from public;

drop trigger if exists club_memberships_clear_access_rejection on public.club_memberships;
create trigger club_memberships_clear_access_rejection
  after insert on public.club_memberships
  for each row execute function public.clear_profile_access_rejection();
