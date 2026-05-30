import { describe, expect, it } from 'vitest';
import { resolveNovaLink } from './novaLinks';

describe('resolveNovaLink', () => {
  it('maps issue links to the issue route', () => {
    expect(resolveNovaLink('nova://issues/issue-philip-gamma-weak-suction')).toBe(
      '/app/issues/issue-philip-gamma-weak-suction',
    );
  });

  it('maps sale links to the sale route', () => {
    expect(resolveNovaLink('nova://sales/sale-philip-gamma-delta-2026-05-26')).toBe(
      '/app/sales/sale-philip-gamma-delta-2026-05-26',
    );
  });

  it('maps role links to the roles screen with a query', () => {
    expect(resolveNovaLink('nova://roles/admin')).toBe('/app/admin/roles?role=admin');
  });

  it('maps sop links to the sop route', () => {
    expect(resolveNovaLink('nova://sops/sop-refund-of-purchase')).toBe(
      '/app/sops/sop-refund-of-purchase',
    );
  });

  it('returns null for unsupported links', () => {
    expect(resolveNovaLink('https://example.com')).toBeNull();
    expect(resolveNovaLink('nova://unknown/thing')).toBeNull();
  });
});
