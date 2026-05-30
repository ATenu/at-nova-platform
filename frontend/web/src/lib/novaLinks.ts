/**
 * Resolver for `nova://` deep links emitted by the agent (e.g. in chat tool
 * links). Maps the supported schemes to in-app routes. Unknown schemes resolve
 * to null so callers can render them as inert text rather than navigating
 * somewhere unexpected.
 */
export function resolveNovaLink(link: string): string | null {
  if (typeof link !== 'string') {
    return null;
  }
  const id = encodeURIComponent(link.split('/').pop() ?? '');
  if (id.length === 0) {
    return null;
  }
  if (link.startsWith('nova://sales/')) return `/app/sales/${id}`;
  if (link.startsWith('nova://issues/')) return `/app/issues/${id}`;
  if (link.startsWith('nova://customers/')) return `/app/customers?customer=${id}`;
  if (link.startsWith('nova://actions/')) return `/app/actions?action=${id}`;
  if (link.startsWith('nova://sops/')) return `/app/sops/${id}`;
  if (link.startsWith('nova://roles/')) return `/app/admin/roles?role=${id}`;
  return null;
}

/** True for links the app knows how to open internally. */
export function isResolvableNovaLink(link: string): boolean {
  return resolveNovaLink(link) !== null;
}
