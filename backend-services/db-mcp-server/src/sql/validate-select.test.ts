import { validateSelect, SqlValidationError } from './validate-select';

/**
 * These tests run the REAL libpg_query parser (via pgsql-parser) so they
 * exercise the exact code path used in production. The validator is the primary
 * SQL-injection / privilege-escalation control, so the negative cases matter as
 * much as the positive ones.
 */
describe('validateSelect', () => {
  it('accepts a single SELECT over an allowlisted view', async () => {
    const result = await validateSelect('SELECT id, full_name FROM mcp_read.customers WHERE active = true');
    expect(result.relations).toEqual(['customers']);
  });

  it('accepts joins across multiple allowlisted views', async () => {
    const result = await validateSelect(
      'SELECT s.id FROM mcp_read.sales s JOIN mcp_read.products_sold ps ON ps.sale_id = s.id',
    );
    expect(new Set(result.relations)).toEqual(new Set(['sales', 'products_sold']));
  });

  it.each([
    ['empty', '   '],
    ['multiple statements', 'SELECT 1 FROM mcp_read.sales; SELECT 2 FROM mcp_read.sales'],
    ['insert', "INSERT INTO mcp_read.sales (id) VALUES ('x')"],
    ['update', 'UPDATE mcp_read.sales SET total_amount_receipt = 0'],
    ['delete', 'DELETE FROM mcp_read.sales'],
    ['ddl drop', 'DROP VIEW mcp_read.sales'],
    ['truncate', 'TRUNCATE mcp_read.sales'],
    ['set', "SET statement_timeout = '0'"],
    ['transaction', 'BEGIN'],
    ['select into', 'SELECT id INTO other FROM mcp_read.sales'],
    ['locking', 'SELECT id FROM mcp_read.sales FOR UPDATE'],
    ['base table', 'SELECT * FROM public.sales'],
    ['catalog', 'SELECT * FROM pg_catalog.pg_class'],
    ['unqualified base table', 'SELECT * FROM sales'],
    ['disallowed view', 'SELECT * FROM mcp_read.secret_view'],
    ['forbidden function', 'SELECT pg_sleep(10) FROM mcp_read.sales'],
    ['set_config', "SELECT set_config('x','y',true)"],
    ['cte with insert', 'WITH w AS (INSERT INTO mcp_read.sales DEFAULT VALUES RETURNING id) SELECT * FROM w'],
    ['subquery base table', 'SELECT * FROM (SELECT * FROM public.users) u'],
    // Classic injection vectors (the validator is the primary control).
    ['union to base table', 'SELECT id FROM mcp_read.sales UNION SELECT password FROM public.users'],
    ['union to catalog', 'SELECT id FROM mcp_read.sales UNION SELECT usename FROM pg_catalog.pg_user'],
    ['stacked drop', 'SELECT 1 FROM mcp_read.sales; DROP TABLE users'],
    ['stacked update via comment', "SELECT 1 FROM mcp_read.sales; UPDATE mcp_read.sales SET x = 1 --"],
    ['copy to file', "COPY mcp_read.sales TO '/tmp/out.csv'"],
    ['file read function', "SELECT pg_read_file('/etc/passwd')"],
    ['lo_export', 'SELECT lo_export(1, 2) FROM mcp_read.sales'],
    ['information_schema', 'SELECT table_name FROM information_schema.tables'],
  ])('rejects %s', async (_label, sql) => {
    await expect(validateSelect(sql)).rejects.toBeInstanceOf(SqlValidationError);
  });

  it('rejects a forbidden function even when schema-qualified', async () => {
    await expect(
      validateSelect('SELECT pg_catalog.pg_sleep(1) FROM mcp_read.sales'),
    ).rejects.toBeInstanceOf(SqlValidationError);
  });

  it('accepts parameterized predicates (placeholders are bound, not interpolated)', async () => {
    const result = await validateSelect(
      'SELECT id FROM mcp_read.sales WHERE customer_id = $1 AND total_amount_receipt > $2',
    );
    expect(result.relations).toEqual(['sales']);
  });
});
