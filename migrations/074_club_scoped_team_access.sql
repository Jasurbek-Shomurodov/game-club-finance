-- =============================================================
-- Club-scoped team access
--
-- Migration 014 let `current_user_is_global_owner()` (true for anyone who owns
-- ANY club) bypass the profile, membership, and club policies. Owners of
-- unrelated clubs could therefore read every profile and membership, rename
-- other clubs, and insert themselves into any club. Every policy below now
-- authorizes against the specific club instead.
--
-- `current_user_is_global_owner()` is kept only for `create_club_with_owner`:
-- any signed-in owner may still create a new club of their own.
--
-- Access requests: a new sign-up has a profile and no memberships. Owners must
-- still see and approve those requests, so a profile with no memberships that
-- has not been rejected (072) stays readable to club owners.
--
-- Rejection (`reject_access_request`) locks the profile, re-checks that the
-- person still has no memberships, and marks it rejected in one transaction.
-- New membership grants lock the same profile row first, so a grant and a
-- rejection can never both succeed.
-- =============================================================

create or replace function public.current_user_owns_any_club()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.club_memberships
    where user_id = auth.uid()
      and role = 'owner'::user_role
  )
$$;

-- True only for an open access request: the person has a profile, no
-- membership in any club (active or not), and has not been rejected.
create or replace function public.is_pending_access_request(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and access_rejected_at is null
  )
  and not exists (
    select 1
    from public.club_memberships
    where user_id = p_user_id
  )
$$;

-- True when the caller is an owner of some club that p_user_id belongs to.
create or replace function public.current_user_owns_club_of(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.club_memberships mine
    join public.club_memberships theirs on theirs.club_id = mine.club_id
    where mine.user_id = auth.uid()
      and mine.role = 'owner'::user_role
      and theirs.user_id = p_user_id
  )
$$;

revoke all on function public.current_user_owns_any_club() from public, anon;
revoke all on function public.is_pending_access_request(uuid) from public, anon;
revoke all on function public.current_user_owns_club_of(uuid) from public, anon;
grant execute on function public.current_user_owns_any_club() to authenticated;
grant execute on function public.is_pending_access_request(uuid) to authenticated;
grant execute on function public.current_user_owns_club_of(uuid) to authenticated;

-- ---------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------
drop policy if exists "profiles_read_self_or_shared_club" on public.profiles;
create policy "profiles_read_self_or_shared_club" on public.profiles
  for select using (
    id = auth.uid()
    or public.shares_club_with_current_user(id)
    or (
      public.current_user_owns_any_club()
      and public.is_pending_access_request(id)
    )
  );

-- Owners may update only the profiles of people in a club they own. Approval
-- never updates a profile (it inserts a membership), and rejection goes
-- through reject_access_request below.
drop policy if exists "profiles_update_owner_only" on public.profiles;
create policy "profiles_update_owner_only" on public.profiles
  for update using (public.current_user_owns_club_of(id))
  with check (public.current_user_owns_club_of(id));

-- ---------------------------------------------------------------
-- club_memberships
-- ---------------------------------------------------------------
drop policy if exists "members_read_club" on public.club_memberships;
create policy "members_read_club" on public.club_memberships
  for select using (
    user_id = auth.uid()
    or public.user_has_club_access(club_id)
  );

-- The old FOR ALL policy is split so each write states its own boundary.
drop policy if exists "owners_manage_members" on public.club_memberships;
drop policy if exists "owners_insert_members" on public.club_memberships;
drop policy if exists "owners_update_members" on public.club_memberships;
drop policy if exists "owners_delete_members" on public.club_memberships;

-- An owner may grant access to their own club for an open access request or
-- for someone who already shares a club with them (adding a teammate to a
-- second club). Arbitrary user IDs from other tenants are refused.
create policy "owners_insert_members" on public.club_memberships
  for insert with check (
    public.current_user_club_role(club_id) = 'owner'
    and (
      public.is_pending_access_request(user_id)
      or public.shares_club_with_current_user(user_id)
    )
  );

create policy "owners_update_members" on public.club_memberships
  for update using (public.current_user_club_role(club_id) = 'owner')
  with check (public.current_user_club_role(club_id) = 'owner');

create policy "owners_delete_members" on public.club_memberships
  for delete using (public.current_user_club_role(club_id) = 'owner');

-- A membership row may change role and feature access, never whose access it
-- is or which club it opens: re-pointing a row would bypass the insert check.
create or replace function public.prevent_membership_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if NEW.club_id is distinct from OLD.club_id
    or NEW.user_id is distinct from OLD.user_id then
    raise exception 'A membership cannot be moved to another club or user.'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

revoke all on function public.prevent_membership_identity_change()
  from public, anon, authenticated;

drop trigger if exists trg_prevent_membership_identity_change on public.club_memberships;
create trigger trg_prevent_membership_identity_change
  before update of club_id, user_id on public.club_memberships
  for each row execute function public.prevent_membership_identity_change();

-- Serializes grants with reject_access_request. A browser grant waits for an
-- in-flight rejection of the same person and is refused once they are
-- rejected. Trusted paths (service role, SQL console) have no auth.uid() and
-- may still grant access; the 072 trigger then clears the rejection mark.
create or replace function public.lock_profile_for_membership_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or NEW.user_id = auth.uid() then
    return NEW;
  end if;

  perform 1
  from public.profiles
  where id = NEW.user_id
    and access_rejected_at is null
  for share;

  if not found then
    raise exception 'This access request is no longer open.'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

revoke all on function public.lock_profile_for_membership_grant()
  from public, anon, authenticated;

drop trigger if exists trg_lock_profile_for_membership_grant on public.club_memberships;
create trigger trg_lock_profile_for_membership_grant
  before insert on public.club_memberships
  for each row execute function public.lock_profile_for_membership_grant();

-- ---------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------
drop policy if exists "members_read_clubs" on public.clubs;
create policy "members_read_clubs" on public.clubs
  for select using (public.user_has_club_access(id));

drop policy if exists "owners_update_clubs" on public.clubs;
create policy "owners_update_clubs" on public.clubs
  for update using (public.current_user_club_role(id) = 'owner')
  with check (public.current_user_club_role(id) = 'owner');

-- ---------------------------------------------------------------
-- Rejecting an access request
-- ---------------------------------------------------------------
-- Returns:
--   'rejected'    the request was open and is now marked rejected; the caller
--                 may delete the sign-up (it cannot regain access in between).
--   'has_access'  the person has a membership (possibly in an inactive club).
--   'not_pending' no such profile, or it was already rejected.
create or replace function public.reject_access_request(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rejected_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if not public.current_user_owns_any_club() then
    raise exception 'Only a club owner can reject access requests.' using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Invalid access request.' using errcode = '22023';
  end if;

  -- Same row lock a concurrent grant takes (lock_profile_for_membership_grant).
  select access_rejected_at
  into v_rejected_at
  from public.profiles
  where id = p_user_id
  for update;

  if not found or v_rejected_at is not null then
    return 'not_pending';
  end if;

  if exists (select 1 from public.club_memberships where user_id = p_user_id) then
    return 'has_access';
  end if;

  update public.profiles
  set access_rejected_at = now(),
      access_rejected_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;

  return 'rejected';
end;
$$;

revoke all on function public.reject_access_request(uuid) from public, anon;
grant execute on function public.reject_access_request(uuid) to authenticated;
