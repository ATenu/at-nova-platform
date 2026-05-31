import { redactRows, redactedColumnNames } from './redact';

describe('redactRows', () => {
  it('masks PII-classified columns and passes through public columns', () => {
    const rows = [{ id: 'c1', full_name: 'Jane Doe', active: true }];
    expect(redactRows(rows)).toEqual([{ id: 'c1', full_name: '[redacted]', active: true }]);
  });

  it('leaves null PII values as null (no value to leak)', () => {
    expect(redactRows([{ full_name: null }])).toEqual([{ full_name: null }]);
  });

  it('does not mutate the input rows', () => {
    const rows = [{ full_name: 'Jane' }];
    redactRows(rows);
    expect(rows[0]).toEqual({ full_name: 'Jane' });
  });

  it('advertises full_name as a redacted column', () => {
    expect(redactedColumnNames()).toContain('full_name');
  });
});
