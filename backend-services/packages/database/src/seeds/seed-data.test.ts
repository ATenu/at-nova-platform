import { customerIssuesSeed, issueActionsSeed, productsSeed, salesSeed } from './seed-data';
import { seedUuid } from './seed-uuid';

const toCents = (amount: string): number => Math.round(Number.parseFloat(amount) * 100);

describe('seed data integrity', () => {
  const priceByName = new Map(productsSeed.map((p) => [p.name, toCents(p.price)]));

  it('every sale total equals subtotal minus discount', () => {
    for (const sale of salesSeed) {
      const subtotal = sale.items.reduce((sum, item) => {
        const price = priceByName.get(item.productName);
        expect(price).toBeDefined();
        return sum + (price ?? 0) * item.quantity;
      }, 0);
      const discount = Math.round((subtotal * Number.parseFloat(sale.discountApplied)) / 100);
      expect(subtotal - discount).toBe(toCents(sale.totalAmountReceipt));
    }
  });

  it('customer issues reference an existing sale seed key', () => {
    const saleKeys = new Set(salesSeed.map((s) => s.seedKey));
    for (const issue of customerIssuesSeed) {
      expect(saleKeys.has(issue.saleSeedKey)).toBe(true);
    }
  });

  it('issue action dependencies reference existing actions', () => {
    const actionKeys = new Set(issueActionsSeed.map((a) => a.seedKey));
    for (const action of issueActionsSeed) {
      for (const dependency of action.dependsOn) {
        expect(actionKeys.has(dependency)).toBe(true);
        expect(dependency).not.toBe(action.seedKey);
      }
    }
  });

  it('seedUuid is deterministic and valid', () => {
    const first = seedUuid('sale-mario-beta-gamma-2026-05-22');
    const second = seedUuid('sale-mario-beta-gamma-2026-05-22');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
