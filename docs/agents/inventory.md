# Inventory and closing-stock guide

Read this before changing products, purchases, stock counts, imports, or bar
financials.

## Inventory model

`products.current_stock` is the live operational balance. Products can either
track inventory or be made to order:

- Tracked products derive sold quantity from opening, additions, explicit
  adjustment, and closing balance.
- Made-to-order products record direct sold quantity without a carried stock
  balance.
- Soft-deleted products are inactive and must have `current_stock = 0`, while
  their historical ledger rows remain unchanged.

New stock purchase quantities must be positive whole units. Historical
fractional rows remain readable for compatibility.

## Canonical calculations

The implementation is `src/lib/calculations/stock.ts`:

```text
previousStock  = latestClosing + purchasesAfterClosingBeforeSelectedDate
availableStock = previousStock + addedToday + adjustmentQuantity
soldQuantity   = max(0, availableStock - closingStock)
barIncome      = soldQuantity * salePrice
barCost        = soldQuantity * costPrice
barProfit      = barIncome - barCost
```

Closing stock cannot exceed available stock unless an owner records an explicit
adjustment and reason through the supported flow.

Direct cost-price changes in the product catalog are owner-only. Owners and
admins with Stock Purchase access can enter each receipt's actual cost through
`record_stock_purchase`; its trusted stock update recalculates average cost.
Admins cannot rewrite existing receipt costs. Migration 058 corrects 056's
purchase restriction while preserving the catalog restriction and RPC-only
ledger writes. Purchase deletion reverses its stock and cost atomically.

Purchase cost updates use weighted average cost:

```text
newCost = (currentStock * currentCost + purchasedQty * purchaseCost)
          / (currentStock + purchasedQty)
```

## Required atomic write paths

Browser code must use these RPCs:

| Operation | RPC |
|---|---|
| Record a purchase and update stock/cost | `record_stock_purchase` |
| Delete a purchase and repair affected state | `delete_stock_purchase` |
| Save closing counts and validate/cascade history | `save_closing_stock_counts` |

Do not split an RPC into separate inserts/updates. The functions lock and
validate related rows so concurrent writes cannot leave partial ledger state.

The dashboard and closing page also use read RPCs
`get_dashboard_snapshot` and `get_stock_opening_balances` for performance.
`get_latest_stock_closings` remains available for older clients. Their
direct-query paths are deployment compatibility fallbacks, not alternative
business definitions.

Migration 057 includes receipts on dates with no closing in the next opening
balance, while `added_today` and purchase-cost cards remain selected-date totals.
Both the read fallback and atomic save use this rule. With no earlier closing,
the current day uses live stock minus same-day purchases; a new historical
closing uses only earlier purchase receipts. Current saved rows refresh their
opening and closing by the same delta, preserving recorded sold quantities.

Apply 057 before deploying the frontend. It does not rewrite saved history or
infer physical stock/sales for dates affected by the old bug. Reconcile affected
historical counts separately using verified stock and sales; purchase receipts
alone do not establish actual sales. Existing historical openings also remain
snapshots when that row is edited, so old rows remain editable. Editing
a historical closing validates/recalculates later openings including intervening
receipts; inserting a missing closing splits the interval without double counting.

Migration 054 removes per-history-row permission lookups from these reads while
preserving the existing RLS results and stock write rules. Apply it to the
database to obtain the speed improvement; a frontend rebuild alone cannot
change query execution inside Supabase.

## Promotions and giveaways (migration 078)

`promotions` holds owner-managed bonus rules (`/promotions`, `inventory`
feature): a product, free units per bill, minimum bill, period, active flag.
A promotion only labels giveaways; the ledger fact is
`daily_stock_counts.giveaway_quantity`, entered by owners/admins on the
closing page ("Free (promo)") and validated by `save_closing_stock_counts`
and the row-integrity trigger:

```text
soldQuantity = previous + added + adjustment - giveaway - closing
barIncome    = sold * salePrice
barCost      = (sold + giveaway) * costPrice   -- giveaway_cost = giveaway * costPrice
```

Giveaways carry no income. Their cost is inside `bar_cost`, so dashboard,
reports, owner money and Telegram totals charge it without separate handling;
`giveaway_cost` repeats it for a "promo cost" line. Forward recalculation of
later rows keeps each row's saved giveaway. Rows saved before 078 have
`giveaway_quantity = 0` and are unchanged. Apply 078 before deploying the
frontend: the older RPC ignores the giveaway and rejects the mismatching sold
quantity.

## Historical snapshot rule

For an open business day, purchases are the live source of `added_today`. Once a
saved stock count is historical, its `added_today`, `closing_stock`, sales, cost,
and profit are an accounting snapshot. Later purchase metadata edits may expose
a mismatch, but must not silently rewrite that saved result.

Owner edits to a past closing are handled atomically and may validate/recalculate
the forward stock chain. Preserve the database behavior in migrations 034 and
038 and the matching tests.

## Relevant files

- `src/app/(dashboard)/products/page.tsx`: product catalog and soft deletion.
- `src/app/(dashboard)/stock-purchase/StockPurchasePage.tsx`: purchase UI/RPCs.
- `src/app/(dashboard)/closing-stock/ClosingStockPage.tsx`: closing workflow.
- `src/lib/closingStock.ts`: drafts/import transformation.
- `src/lib/supabase/stockOpeningBalances.ts`: opening read RPC and paginated fallback.
- `src/lib/calculations/stock.ts`: pure formulas.
- `src/lib/calculations/barMoney.ts`: bar cash and purchase cutoff.
- `migrations/034_atomic_closing_stock_save.sql`: atomic stock model.
- `migrations/038_stock_snapshot_and_payment_method_integrity.sql`:
  historical snapshot and archive rules.

## Verification focus

Test current-day purchases, purchase deletion, historical closings, forward
stock-chain edits, made-to-order sales, soft deletion, adjustments, weighted
cost, and the bar-money cutoff. See `docs/agents/testing.md` for commands.
