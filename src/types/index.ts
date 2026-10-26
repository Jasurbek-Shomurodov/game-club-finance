// Shared application data types.

export type UserRole = 'owner' | 'admin' | 'viewer';
export const PAYMENT_METHODS = ['terminal', 'cash', 'card'] as const;
export type EntryPaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentMethod = EntryPaymentMethod | 'qr' | 'transfer' | 'debt';
export type PaymentSource = 'cash' | 'terminal' | 'bank';
export type IncomeCategory = 'game_time' | 'food' | 'drinks' | 'other';
export type ExpenseCategory =
  | 'rent' | 'salary' | 'electricity' | 'internet' | 'repair'
  | 'cleaning' | 'food_drinks' | 'marketing' | 'equipment' | 'tax'
  | 'correction' | 'discount' | 'supplies' | 'investments' | 'other';
export type ExpensePaymentSource = 'game_club' | 'bar';
export const OWNER_WITHDRAWAL_SOURCES = ['game_club', 'bar'] as const;
export type OwnerWithdrawalSource = (typeof OWNER_WITHDRAWAL_SOURCES)[number];
/** Game Club money buckets an owner withdrawal can be taken from (migration 066). */
export const OWNER_WITHDRAWAL_PAYMENT_METHODS = ['cash', 'terminal', 'card', 'playstation'] as const;
export type OwnerWithdrawalPaymentMethod = (typeof OWNER_WITHDRAWAL_PAYMENT_METHODS)[number];
export type MovementType = 'deposit' | 'withdraw' | 'correction';
export type DebtStatus = 'unpaid' | 'partial' | 'paid';

// Legacy types for old pages
export interface Balance {
  id: string;
  club_id: string;
  account: 'cash' | 'terminal' | 'bank' | 'debt';
  amount: number;
  updated_at: string;
}

export interface IncomeTransaction {
  id: string;
  club_id: string;
  amount: number;
  payment_method: PaymentMethod;
  category: IncomeCategory;
  comment: string | null;
  transaction_date: string;
  created_by: string;
  created_at: string;
}

export interface ExpenseTransaction {
  id: string;
  club_id: string;
  amount: number;
  category: ExpenseCategory;
  payment_source: PaymentSource;
  comment: string | null;
  transaction_date: string;
  created_by: string;
  created_at: string;
}

export interface CashMovement {
  id: string;
  club_id: string;
  movement_type: MovementType;
  account: string;
  amount: number;
  comment: string | null;
  created_by: string;
  created_at: string;
}

export interface LegacyDebt {
  id: string;
  club_id: string;
  customer_name: string;
  amount: number;
  comment: string | null;
  debt_date: string;
  status: 'unpaid' | 'paid';
  paid_at: string | null;
  paid_method: PaymentMethod | null;
  created_by: string;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  /** Set when an owner rejected the access request (072); cleared when access is granted. */
  access_rejected_at: string | null;
  access_rejected_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Club {
  id: string;
  name: string;
  address: string | null;
  business_day_start_hour?: number | null;
  enabled_payment_methods?: EntryPaymentMethod[] | null;
  /** Day of the month (1-31) the internet bill is due; read by Settings and the Telegram report (087). */
  internet_payment_day?: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClubMembership {
  club_id: string;
  user_id: string;
  role: UserRole;
  feature_access?: string[] | null;
  created_at: string;
  updated_at: string;
  clubs?: Club | Club[] | null;
}

export interface Product {
  id: string;
  club_id: string;
  name: string;
  category: string | null;
  sale_price: number;
  cost_price: number;
  current_stock: number;
  tracks_inventory?: boolean;
  low_stock_threshold: number | null;
  sort_order?: number | null;
  is_active: boolean;
  is_deleted?: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyCashEntry {
  id: string;
  club_id: string;
  date: string;
  cash_income: number;
  terminal_income: number;
  card_income: number;
  playstation_income: number;
  comment: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockPurchase {
  id: string;
  club_id: string;
  date: string;
  product_id: string;
  quantity: number;
  cost_price: number;
  sale_price: number | null;
  payment_method: string;
  comment: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DailyStockCount {
  id: string;
  club_id: string;
  date: string;
  product_id: string;
  previous_stock: number;
  added_today: number;
  closing_stock: number;
  sold_quantity: number;
  sale_price: number;
  cost_price: number;
  bar_income: number;
  bar_cost: number;
  bar_profit: number;
  /** Manual stock correction recorded with the count (034). */
  adjustment_quantity: number;
  adjustment_reason: string | null;
  adjustment_recorded_by: string | null;
  adjustment_recorded_at: string | null;
  giveaway_quantity?: number;
  giveaway_cost?: number;
  promotion_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A club bonus rule: `free_quantity` of `product_id` free for a bill of at least `min_spend`. */
export interface Promotion {
  id: string;
  club_id: string;
  product_id: string;
  name: string;
  free_quantity: number;
  min_spend: number;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  club_id: string;
  date: string;
  amount: number;
  payment_method: string;
  payment_source: ExpensePaymentSource;
  category: string;
  comment: string | null;
  telegram_chat_id: string | null;
  telegram_message_id: number | null;
  /** The salary payment this expense mirrors (059); null for ordinary expenses. */
  salary_entry_id: string | null;
  /** The planned expense this payment counts against (091); null when none was picked. */
  preset_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewDebt {
  id: string;
  club_id: string;
  person_name: string;
  date: string;
  amount: number;
  paid_amount: number;
  remaining_amount: number;
  category: string | null;
  comment: string | null;
  status: DebtStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebtPayment {
  id: string;
  club_id: string;
  debt_id: string;
  date: string;
  amount: number;
  payment_method: string;
  comment: string | null;
  /** Author; null for payments recorded before migration 086. */
  created_by: string | null;
  created_at: string;
}

export interface OwnerWithdrawal {
  id: string;
  club_id: string;
  /** First day of the calendar month represented by this withdrawal. */
  period_month: string;
  source: OwnerWithdrawalSource;
  /** Game Club only; null for Bar and for withdrawals recorded without a method. */
  payment_method?: OwnerWithdrawalPaymentMethod | null;
  amount: number;
  comment: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Unwithdrawn profit moved from one month into the next (migration 071). */
export interface OwnerProfitCarryover {
  id: string;
  club_id: string;
  /** First day of the month the money leaves. */
  from_month: string;
  /** First day of the following month, which receives the money. */
  to_month: string;
  source: OwnerWithdrawalSource;
  /** Required for Game Club; null for Bar. */
  payment_method: OwnerWithdrawalPaymentMethod | null;
  amount: number;
  comment: string | null;
  created_by: string;
  created_at: string;
}

export interface ClubShowcase {
  club_id: string;
  slug: string;
  is_published: boolean;
  headline: string | null;
  tagline: string | null;
  hero_image_url: string | null;
  address: string | null;
  phone: string | null;
  opening_hours: string | null;
  telegram_url: string | null;
  instagram_url: string | null;
  updated_at: string;
}

export interface ShowcaseGame {
  id: string;
  club_id: string;
  title: string;
  genre: string | null;
  image_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface ShowcasePcZone {
  id: string;
  club_id: string;
  name: string;
  pc_count: number;
  cpu: string | null;
  gpu: string | null;
  ram: string | null;
  storage: string | null;
  monitor: string | null;
  monitor_size_inches: number | null;
  monitor_refresh_hz: number | null;
  mouse: string | null;
  keyboard: string | null;
  headset: string | null;
  chair: string | null;
  peripherals: string | null;
  price_per_hour: number | null;
  image_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface ShowcaseBrand {
  owner_id: string;
  slug: string;
  name: string;
  tagline: string | null;
  hero_image_url: string | null;
  telegram_url: string | null;
  instagram_url: string | null;
  is_published: boolean;
  updated_at: string;
}
