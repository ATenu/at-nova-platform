import { describeSchema, listViews } from './describe-schema';

describe('describeSchema', () => {
  it('only describes allowlisted mcp_read views', () => {
    const views = describeSchema();
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((view) => view.schema === 'mcp_read')).toBe(true);
  });

  it('flags PII columns so the planner is steered away from them', () => {
    const customers = describeSchema().find((view) => view.name === 'customers');
    const fullName = customers?.columns.find((column) => column.name === 'full_name');
    expect(fullName?.pii).toBe(true);
  });

  it('marks the owner-scoped view', () => {
    const mine = describeSchema().find((view) => view.name === 'my_assigned_actions');
    expect(mine?.ownerScoped).toBe(true);
  });
});

describe('listViews', () => {
  it('lists view names with descriptions', () => {
    const names = listViews().map((view) => view.name);
    expect(names).toContain('sales');
    expect(names).toContain('customers');
  });
});
