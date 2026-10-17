-- Owner-only diagnostics for the Settings health check. The app sends the schema probes
-- generated from its committed migrations (src/lib/supabase/migrationManifest.json); this
-- answers, for each one, whether that object exists. Reads catalog metadata only.
create or replace function public.get_migration_probe_results(p_club_id uuid, p_probes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  results jsonb := '[]'::jsonb;
  probe jsonb;
  target text;
  rel regclass;
  found boolean;
begin
  if auth.uid() is null
    or public.current_user_club_role(p_club_id) is distinct from 'owner'::public.user_role then
    raise exception 'Only a club owner can inspect migration health' using errcode = '42501';
  end if;
  if jsonb_typeof(p_probes) is distinct from 'array' or jsonb_array_length(p_probes) > 5000 then
    raise exception 'Probes must be an array of at most 5000 items' using errcode = '22023';
  end if;

  for probe in select value from jsonb_array_elements(p_probes) loop
    found := false;
    begin
      target := coalesce(probe->>'table', probe->>'name');
      rel := case when probe->>'kind' in ('relation', 'column', 'constraint', 'policy', 'trigger')
        then to_regclass(quote_ident(split_part(target, '.', 1)) || '.' || quote_ident(split_part(target, '.', 2))) end;
      found := case probe->>'kind'
        when 'relation' then rel is not null
        when 'type' then to_regtype(quote_ident(split_part(target, '.', 1)) || '.' || quote_ident(split_part(target, '.', 2))) is not null
        when 'enumValue' then exists (
          select 1 from pg_enum
          where enumtypid = to_regtype(quote_ident(split_part(probe->>'type', '.', 1)) || '.' || quote_ident(split_part(probe->>'type', '.', 2)))
            and enumlabel = probe->>'value')
        when 'column' then exists (
          select 1 from pg_attribute
          where attrelid = rel and attname = probe->>'column' and attnum > 0 and not attisdropped)
        when 'constraint' then exists (select 1 from pg_constraint where conrelid = rel and conname = probe->>'name')
        when 'policy' then exists (select 1 from pg_policy where polrelid = rel and polname = probe->>'name')
        when 'trigger' then exists (
          select 1 from pg_trigger where tgrelid = rel and tgname = probe->>'name' and not tgisinternal)
        when 'function' then to_regprocedure(probe->>'signature') is not null
        when 'functionBody' then exists (
          select 1 from pg_proc
          where oid = to_regprocedure(probe->>'signature') and md5(prosrc) = probe->>'md5')
        else false end;
    exception when others then
      found := false;
    end;
    results := results || to_jsonb(coalesce(found, false));
  end loop;

  return results;
end;
$$;

revoke all on function public.get_migration_probe_results(uuid, jsonb) from public, anon;
grant execute on function public.get_migration_probe_results(uuid, jsonb) to authenticated;
