/**
 * Money helpers. The backend returns monetary values as strings because
 * PostgreSQL `numeric` must not be treated as floating point. We keep values as
 * strings end-to-end and only parse to a number for arithmetic, always
 * re-normalizing to a fixed two-decimal string for transport and display.
 */

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

/** Parse a backend money string to a finite number, or 0 when invalid. */
export function parseMoney(value: string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Normalize a numeric amount to a transport-safe fixed two-decimal string. */
export function toMoneyString(amount: number): string {
  if (!Number.isFinite(amount)) {
    return '0.00';
  }
  return amount.toFixed(2);
}

/** Format a money string (or number) for display with currency symbol. */
export function formatMoney(value: string | number | null | undefined): string {
  const amount = typeof value === 'number' ? value : parseMoney(value);
  return CURRENCY_FORMATTER.format(amount);
}

export interface SaleTotals {
  readonly subtotal: number;
  readonly discount: number;
  readonly total: number;
}

/**
 * Compute sale receipt totals from line items and a discount percentage.
 * Mirrors the backend formula: subtotal - (subtotal * discount%).
 */
export function computeSaleTotals(
  items: ReadonlyArray<{ unitPrice: string; quantity: number }>,
  discountAppliedPercent: number,
): SaleTotals {
  const subtotal = items.reduce(
    (sum, item) => sum + parseMoney(item.unitPrice) * Math.max(0, item.quantity),
    0,
  );
  const safeDiscount = Math.min(100, Math.max(0, discountAppliedPercent));
  const discount = (subtotal * safeDiscount) / 100;
  const total = subtotal - discount;
  return { subtotal, discount, total };
}
