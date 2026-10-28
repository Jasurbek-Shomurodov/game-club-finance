-- Google Business Profile (the club's Google Maps listing). An owner signs in
-- with the Google account that manages the listing once; the server keeps the
-- encrypted refresh token here and uses it to publish posts and photos.
--
-- The row holds a credential, so browser roles get nothing: the server routes
-- under /api/google-business check the caller's club access with the user's
-- own client (current_user_club_role / current_user_can_access_club_feature)
-- and then read or write this table with the service client. Re-runnable.

create table if not exists public.google_business_connections (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  google_email text,
  refresh_token_encrypted text not null,
  account_name text,
  location_name text,
  location_title text,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_business_connections_account_name_format
    check (account_name is null or account_name ~ '^accounts/[0-9]+$'),
  constraint google_business_connections_location_name_format
    check (location_name is null or location_name ~ '^locations/[0-9]+$'),
  constraint google_business_connections_location_needs_account
    check (location_name is null or account_name is not null)
);

alter table public.google_business_connections enable row level security;

revoke all on table public.google_business_connections
  from public, anon, authenticated;
grant select, insert, update, delete on table public.google_business_connections
  to service_role;
