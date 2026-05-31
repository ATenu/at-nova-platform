import { MCP_READ_SCHEMA, MCP_READ_VIEWS } from '../data/views';

/**
 * Schema description for the planner, derived SOLELY from the curated
 * `mcp_read` allowlist (`data/views.ts`) — never from live catalog reflection.
 * This guarantees the advertised surface can never exceed the reviewed,
 * PII-aware view set: a table that is not in the allowlist is invisible and
 * unqueryable. PII-classified columns are flagged so the planner is steered
 * away from selecting them (they are also masked at output by the redactor).
 */
export interface DescribedColumn {
  readonly name: string;
  readonly type: string;
  readonly pii: boolean;
  readonly description?: string;
}

export interface DescribedView {
  readonly schema: string;
  readonly name: string;
  readonly description: string;
  readonly ownerScoped: boolean;
  readonly columns: readonly DescribedColumn[];
}

export function describeSchema(): DescribedView[] {
  return MCP_READ_VIEWS.map((view) => ({
    schema: MCP_READ_SCHEMA,
    name: view.name,
    description: view.description,
    ownerScoped: view.ownerScoped,
    columns: view.columns.map((column) => ({
      name: column.name,
      type: column.type,
      pii: column.sensitivity === 'pii',
      ...(column.description ? { description: column.description } : {}),
    })),
  }));
}

/** Compact view list (name + description + owner-scoping) for `list_views`. */
export function listViews(): { schema: string; name: string; description: string; ownerScoped: boolean }[] {
  return MCP_READ_VIEWS.map((view) => ({
    schema: MCP_READ_SCHEMA,
    name: view.name,
    description: view.description,
    ownerScoped: view.ownerScoped,
  }));
}
