import { computeReceiptTotalCents, decimalToScaledBigInt, scaledBigIntToDecimal } from './money';

describe('money helpers', () => {
  it('parses and formats decimals without floating-point error', () => {
    expect(decimalToScaledBigInt('200.00', 2)).toBe(20000n);
    expect(decimalToScaledBigInt('15', 2)).toBe(1500n);
    expect(decimalToScaledBigInt('5.5', 2)).toBe(550n);
    expect(scaledBigIntToDecimal(20700n, 2)).toBe('207.00');
    expect(scaledBigIntToDecimal(5n, 2)).toBe('0.05');
  });

  it('computes the discounted receipt total matching the seed data', () => {
    // Alpha (200.00 x1) + Delta (15.00 x2) = 230.00, 10% discount -> 207.00
    const total = computeReceiptTotalCents(
      [
        { priceCents: 20000n, quantity: 1 },
        { priceCents: 1500n, quantity: 2 },
      ],
      '10.00',
    );
    expect(scaledBigIntToDecimal(total, 2)).toBe('207.00');

    // Gamma (50.00 x2) + Delta (15.00 x3) = 145.00, 5% discount -> 137.75
    const philip = computeReceiptTotalCents(
      [
        { priceCents: 5000n, quantity: 2 },
        { priceCents: 1500n, quantity: 3 },
      ],
      '5.00',
    );
    expect(scaledBigIntToDecimal(philip, 2)).toBe('137.75');
  });

  it('returns the subtotal when there is no discount', () => {
    const total = computeReceiptTotalCents([{ priceCents: 15000n, quantity: 1 }], '0.00');
    expect(scaledBigIntToDecimal(total, 2)).toBe('150.00');
  });
});
