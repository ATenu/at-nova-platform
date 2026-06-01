import { entitledViews, findForbiddenView } from './view-access';

describe('entitledViews', () => {
  it('maps domain permissions to the readable mcp_read views', () => {
    const views = entitledViews(['create-agent-run', 'read-sales']);
    expect([...views].sort()).toEqual(['products', 'products_sold', 'sales']);
  });

  it('returns an empty set when no domain read permission is present', () => {
    expect(entitledViews(['create-agent-run']).size).toBe(0);
  });
});

describe('findForbiddenView (default-deny across views)', () => {
  it('allows a query whose relations are all entitled', () => {
    const entitled = entitledViews(['read-sales']);
    expect(findForbiddenView(['sales'], entitled)).toBeNull();
    expect(findForbiddenView(['sales', 'products'], entitled)).toBeNull();
  });

  it('denies a relation the caller is not entitled to, with the required permission', () => {
    const entitled = entitledViews(['read-sales']);
    expect(findForbiddenView(['customers'], entitled)).toEqual({
      view: 'customers',
      requiredPermission: 'read-customers',
    });
  });

  it('denies a join when ANY touched view is not entitled', () => {
    const entitled = entitledViews(['read-sales']);
    const denial = findForbiddenView(['sales', 'customers'], entitled);
    expect(denial?.view).toBe('customers');
    expect(denial?.requiredPermission).toBe('read-customers');
  });
});
