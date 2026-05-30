import { describe, expect, it } from 'vitest';
import { computeSaleTotals, parseMoney, toMoneyString } from './money';

describe('money', () => {
  it('parses backend money strings without floating point drift', () => {
    expect(parseMoney('137.75')).toBeCloseTo(137.75);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney('not-a-number')).toBe(0);
  });

  it('normalizes amounts to two-decimal transport strings', () => {
    expect(toMoneyString(207)).toBe('207.00');
    expect(toMoneyString(137.745)).toBe('137.75');
  });

  it('computes sale totals using the documented formula', () => {
    const totals = computeSaleTotals(
      [
        { unitPrice: '50.00', quantity: 2 },
        { unitPrice: '15.00', quantity: 3 },
      ],
      5,
    );
    expect(totals.subtotal).toBeCloseTo(145);
    expect(totals.discount).toBeCloseTo(7.25);
    expect(totals.total).toBeCloseTo(137.75);
    expect(toMoneyString(totals.total)).toBe('137.75');
  });

  it('clamps discount to the 0–100 range', () => {
    const totals = computeSaleTotals([{ unitPrice: '100.00', quantity: 1 }], 150);
    expect(totals.total).toBe(0);
  });
});
