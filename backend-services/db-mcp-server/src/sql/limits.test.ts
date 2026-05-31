import { clampSelectToLimit, capResultBytes } from './limits';

describe('clampSelectToLimit', () => {
  it('wraps the query in an outer LIMIT', () => {
    expect(clampSelectToLimit('SELECT id FROM mcp_read.sales', 500)).toBe(
      'SELECT * FROM (SELECT id FROM mcp_read.sales) AS _mcp_capped LIMIT 500',
    );
  });

  it('strips a trailing semicolon before wrapping', () => {
    expect(clampSelectToLimit('SELECT 1;  ', 10)).toBe('SELECT * FROM (SELECT 1) AS _mcp_capped LIMIT 10');
  });

  it('caps even when the inner query has a larger LIMIT', () => {
    const sql = clampSelectToLimit('SELECT id FROM mcp_read.sales LIMIT 100000', 500);
    expect(sql.endsWith('LIMIT 500')).toBe(true);
  });
});

describe('capResultBytes', () => {
  it('returns all rows when within the budget', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const result = capResultBytes(rows, 10_000);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('drops rows and flags truncation when over the byte budget', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ value: `row-${i}-padding-padding` }));
    const result = capResultBytes(rows, 200);
    expect(result.truncated).toBe(true);
    expect(result.rows.length).toBeLessThan(rows.length);
    expect(Buffer.byteLength(JSON.stringify(result.rows), 'utf8')).toBeLessThanOrEqual(200);
  });

  it('handles an empty result', () => {
    expect(capResultBytes([], 10)).toEqual({ rows: [], truncated: false });
  });
});
