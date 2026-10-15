import type { UserRole } from '@/types';

export const FEATURE_DEFINITIONS = [
  { key: 'dashboard', paths: ['/'], labelKey: 'dashboard', descriptionKey: 'dashboardDescription' },
  { key: 'daily_cash', paths: ['/daily-cash', '/income'], labelKey: 'dailyCash', descriptionKey: 'dailyCashDescription' },
  { key: 'closing_stock', paths: ['/closing-stock', '/promotions'], labelKey: 'closingStock', descriptionKey: 'closingStockDescription' },
  { key: 'stock_purchase', paths: ['/stock-purchase'], labelKey: 'stockPurchase', descriptionKey: 'stockPurchaseDescription' },
  { key: 'expenses', paths: ['/expenses', '/expense', '/balance'], labelKey: 'expenses', descriptionKey: 'expensesDescription' },
  { key: 'reports', paths: ['/reports', '/daily-report', '/monthly-report'], labelKey: 'reports', descriptionKey: 'reportsDescription' },
  { key: 'owner_profit', paths: ['/money-taken'], labelKey: 'ownerProfit', descriptionKey: 'ownerProfitDescription' },
  { key: 'debts', paths: ['/debts'], labelKey: 'debts', descriptionKey: 'debtsDescription' },
  { key: 'inventory', paths: ['/products'], labelKey: 'inventory', descriptionKey: 'inventoryDescription' },
  { key: 'salaries', paths: ['/salaries'], labelKey: 'salaries', descriptionKey: 'salariesDescription' },
  { key: 'assistant', paths: ['/assistant'], labelKey: 'assistant', descriptionKey: 'assistantDescription' },
  { key: 'team', paths: ['/team'], labelKey: 'team', descriptionKey: 'teamDescription', ownerOnly: true },
  { key: 'settings', paths: ['/settings'], labelKey: 'settings', descriptionKey: 'settingsDescription' },
] as const;

export type FeatureKey = (typeof FEATURE_DEFINITIONS)[number]['key'];

const FEATURE_KEYS = FEATURE_DEFINITIONS.map((feature) => feature.key) as FeatureKey[];

const ROLE_DEFAULTS: Record<UserRole, FeatureKey[]> = {
  owner: FEATURE_KEYS,
  admin: [
    'dashboard',
    'daily_cash',
    'closing_stock',
    'stock_purchase',
    'expenses',
    'reports',
    'owner_profit',
    'debts',
    'inventory',
    'settings',
  ],
  viewer: ['dashboard', 'reports', 'owner_profit', 'debts', 'inventory', 'settings'],
};

export function normalizeFeatureAccess(value: unknown): FeatureKey[] | null {
  if (!Array.isArray(value)) return null;
  const requested = new Set(value.map((item) => String(item)));
  return FEATURE_KEYS.filter((key) => requested.has(key));
}

export function featureAccessForMembership(role: UserRole, explicitAccess: unknown): FeatureKey[] {
  if (role === 'owner') return FEATURE_KEYS;
  return normalizeFeatureAccess(explicitAccess) ?? ROLE_DEFAULTS[role];
}

export function updateFeatureAccessSelection(
  currentAccess: unknown,
  featureKey: FeatureKey,
  enabled: boolean,
): FeatureKey[] {
  const selected = new Set(normalizeFeatureAccess(currentAccess) ?? []);
  if (enabled) selected.add(featureKey);
  else selected.delete(featureKey);
  return FEATURE_KEYS.filter((key) => selected.has(key));
}

export function featureForPath(pathname: string): FeatureKey | null {
  const normalizedPath = pathname !== '/' ? pathname.replace(/\/$/, '') : pathname;
  if (
    normalizedPath === '/bar-money-details'
    || normalizedPath === '/game-club-money-details'
    || normalizedPath === '/financial-analysis'
  ) {
    return 'dashboard';
  }
  if (normalizedPath === '/test-checklist') return 'team';

  return FEATURE_DEFINITIONS.find((feature) =>
    feature.paths.some((path) => normalizedPath === path || (path !== '/' && normalizedPath.startsWith(`${path}/`))),
  )?.key ?? null;
}

export function canAccessFeature(role: UserRole, explicitAccess: unknown, featureKey: FeatureKey): boolean {
  const definition = FEATURE_DEFINITIONS.find((feature) => feature.key === featureKey);
  if (definition && 'ownerOnly' in definition && definition.ownerOnly && role !== 'owner') return false;
  return featureAccessForMembership(role, explicitAccess).includes(featureKey);
}

export function canAccessPath(role: UserRole, explicitAccess: unknown, pathname: string): boolean {
  const normalizedPath = pathname !== '/' ? pathname.replace(/\/$/, '') : pathname;
  // Salary balances are visible to club members; the salaries feature grants editing.
  if (normalizedPath === '/salaries' || normalizedPath.startsWith('/salaries/')) return true;
  if (normalizedPath === '/reports') {
    return canAccessFeature(role, explicitAccess, 'reports') || canAccessFeature(role, explicitAccess, 'expenses');
  }

  const feature = featureForPath(pathname);
  return feature === null || canAccessFeature(role, explicitAccess, feature);
}

export function defaultPathForAccess(role: UserRole, explicitAccess: unknown): string | null {
  const access = featureAccessForMembership(role, explicitAccess);
  for (const feature of FEATURE_DEFINITIONS) {
    if (access.includes(feature.key) && (!('ownerOnly' in feature) || !feature.ownerOnly || role === 'owner')) {
      return feature.key === 'expenses' ? '/reports' : feature.paths[0];
    }
  }
  return '/salaries';
}

/** These feature unions grant reads of every input to accounting net profit. */
export function canReadFinancialTotals(role: UserRole, explicitAccess: unknown): boolean {
  return (['dashboard', 'reports', 'owner_profit'] as const).some((key) => canAccessFeature(role, explicitAccess, key));
}
