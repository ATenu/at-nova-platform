/**
 * Decimal-safe money helpers. Monetary values are handled as scaled BigInts
 * (integer minor units) to avoid floating-point error, and surfaced as strings
 * with a fixed scale — matching the PostgreSQL `numeric` columns.
 */

/** Parse a decimal string into a scaled BigInt (e.g. "12.50", scale 2 -> 1250n). */
export function decimalToScaledBigInt(value: string, scale: number): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart = '0', fracPart = ''] = unsigned.split('.');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const fracPadded = (fracPart + '0'.repeat(scale)).slice(0, scale);
  const magnitude = BigInt(`${intPart || '0'}${fracPadded}`);
  return negative ? -magnitude : magnitude;
}

/** Format a scaled BigInt back to a fixed-scale decimal string. */
export function scaledBigIntToDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const cut = digits.length - scale;
  const result = scale > 0 ? `${digits.slice(0, cut)}.${digits.slice(cut)}` : digits;
  return negative ? `-${result}` : result;
}

export interface ReceiptLine {
  readonly priceCents: bigint;
  readonly quantity: number;
}

/**
 * Compute the receipt total in cents from line items and an optional discount
 * percentage (e.g. "10.00" = 10%). Rounds half up to the nearest cent. This is
 * the authoritative total; client-supplied totals are never trusted.
 */
export function computeReceiptTotalCents(
  lines: readonly ReceiptLine[],
  discountPercent: string | null,
): bigint {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.priceCents * BigInt(line.quantity),
    0n,
  );
  if (!discountPercent) {
    return subtotal;
  }
  // discountPercent has up to 2 decimals; express as centi-percent out of 10000.
  const centiPercent = decimalToScaledBigInt(discountPercent, 2);
  const retained = 10_000n - centiPercent;
  return (subtotal * retained + 5_000n) / 10_000n;
}
