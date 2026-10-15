-- AI assistant feature key. Owners always have it; other members get it only
-- when an owner grants it explicitly, so role defaults (NULL feature_access)
-- do not change. The assistant reads ledgers through the member's own RLS, so
-- no ledger policy changes are needed.

alter table public.club_memberships
  drop constraint if exists club_memberships_feature_access_valid;

alter table public.club_memberships
  add constraint club_memberships_feature_access_valid
  check (
    feature_access is null
    or feature_access <@ array[
      'dashboard',
      'daily_cash',
      'closing_stock',
      'stock_purchase',
      'expenses',
      'reports',
      'owner_profit',
      'debts',
      'inventory',
      'salaries',
      'assistant',
      'team',
      'settings'
    ]::text[]
  );
