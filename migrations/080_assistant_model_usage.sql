-- Daily request counts for the AI assistant's free-tier Gemini models. The
-- quota belongs to the deployment's single API key, not to a club, so rows
-- are global. Only trusted server code (service role) reads or writes them;
-- members see derived totals through /api/assistant/usage.

create table if not exists public.assistant_model_usage (
  -- Gemini daily quotas reset at midnight Pacific time; this is that date.
  usage_date date not null,
  model text not null check (char_length(model) between 1 and 100),
  requests integer not null default 0 check (requests >= 0),
  -- Set when the provider rejected the model for its daily quota.
  exhausted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (usage_date, model)
);

alter table public.assistant_model_usage enable row level security;

revoke all on table public.assistant_model_usage from public, anon, authenticated;
grant select, insert, update on table public.assistant_model_usage to service_role;

create or replace function public.record_assistant_model_request(
  p_usage_date date,
  p_model text,
  p_exhausted boolean default false
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.assistant_model_usage (usage_date, model, requests, exhausted)
  values (p_usage_date, p_model, case when p_exhausted then 0 else 1 end, p_exhausted)
  on conflict (usage_date, model) do update
    set requests = public.assistant_model_usage.requests + case when p_exhausted then 0 else 1 end,
        exhausted = public.assistant_model_usage.exhausted or p_exhausted,
        updated_at = now();
$$;

revoke all on function public.record_assistant_model_request(date, text, boolean) from public, anon, authenticated;
grant execute on function public.record_assistant_model_request(date, text, boolean) to service_role;
