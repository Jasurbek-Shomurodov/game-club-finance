-- A debt's author is the signed-in user, never a value the browser chooses.
-- The column now defaults to auth.uid(), and the append-only insert policy
-- (036) additionally requires created_by to be that user. Its role and feature
-- checks are unchanged. Older clients that still send their own user id pass
-- the check; rows inserted by trusted service-role scripts bypass RLS.
--
-- debt_payments has no created_by column, so it is unchanged.

alter table public.new_debts
  alter column created_by set default auth.uid();

drop policy if exists "club_admin_insert_debts" on public.new_debts;

create policy "club_admin_insert_debts" on public.new_debts
  for insert with check (
    public.current_user_club_role(club_id) in ('admin', 'owner')
    and public.current_user_can_access_club_feature(club_id, 'debts')
    and created_by = auth.uid()
  );
