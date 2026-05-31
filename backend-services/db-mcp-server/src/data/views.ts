/**
 * The reviewed `mcp_read` allowlist — a SECURITY BOUNDARY (decision D6).
 *
 * This is the single source of truth for three controls:
 *  1. the FROM allowlist enforced by the SQL validator (`sql/validate-select.ts`):
 *     every referenced relation must resolve to `MCP_READ_SCHEMA.<allowlisted view>`;
 *  2. the queryable surface advertised by `describe_schema` / `list_views`; and
 *  3. column classification used by the redaction layer (`sql/redact.ts`).
 *
 * The curated views already exclude hard PII at the database layer; the column
 * classification here is defense in depth — anything marked `pii` is masked in
 * results even if a future view change exposes it. Changing this allowlist is a
 * security-sensitive change and must go through the PII review.
 */

export const MCP_READ_SCHEMA = 'mcp_read' as const;

/** Column sensitivity. `pii` columns are masked by the redaction layer. */
export type ColumnSensitivity = 'public' | 'pii';

export interface ViewColumn {
  readonly name: string;
  /** Postgres type, for the schema description handed to the planner. */
  readonly type: string;
  readonly sensitivity: ColumnSensitivity;
  readonly description?: string;
}

export interface ViewDescriptor {
  readonly name: string;
  readonly description: string;
  /** When true, rows are scoped to the acting subject via the session GUC. */
  readonly ownerScoped: boolean;
  readonly columns: readonly ViewColumn[];
}

const PUBLIC = 'public' as const;
const PII = 'pii' as const;

export const MCP_READ_VIEWS: readonly ViewDescriptor[] = [
  {
    name: 'customers',
    description: 'Customers (PII-aware: email and age excluded; display name masked).',
    ownerScoped: false,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      // Curated out of hard PII, but the customer name is still personal data;
      // masked by default in the free-query surface.
      { name: 'full_name', type: 'varchar', sensitivity: PII },
      { name: 'active', type: 'boolean', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'products',
    description: 'Product catalog.',
    ownerScoped: false,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'name', type: 'varchar', sensitivity: PUBLIC },
      { name: 'description', type: 'text', sensitivity: PUBLIC },
      { name: 'category', type: 'varchar', sensitivity: PUBLIC },
      { name: 'price', type: 'numeric', sensitivity: PUBLIC },
      { name: 'in_catalog', type: 'boolean', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'sales',
    description: 'Sales facts (financial; no direct PII).',
    ownerScoped: false,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'customer_id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'discount_applied', type: 'numeric', sensitivity: PUBLIC },
      { name: 'date', type: 'timestamptz', sensitivity: PUBLIC },
      { name: 'total_amount_receipt', type: 'numeric', sensitivity: PUBLIC },
      { name: 'payment_received', type: 'boolean', sensitivity: PUBLIC },
      { name: 'date_of_payment', type: 'timestamptz', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'products_sold',
    description: 'Sale line items.',
    ownerScoped: false,
    columns: [
      { name: 'sale_id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'product_id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'quantity', type: 'integer', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'customer_issues',
    description: 'Customer issues (status/timeline; free-text description excluded).',
    ownerScoped: false,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'sales_id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'date_raised', type: 'timestamptz', sensitivity: PUBLIC },
      { name: 'date_last_update', type: 'timestamptz', sensitivity: PUBLIC },
      { name: 'status', type: 'text', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'issue_actions',
    description: 'Issue actions (title + status + ownership; description excluded).',
    ownerScoped: false,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'issue_id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'title', type: 'varchar', sensitivity: PUBLIC },
      { name: 'status', type: 'text', sensitivity: PUBLIC },
      { name: 'updated_ai', type: 'boolean', sensitivity: PUBLIC },
      { name: 'created_date', type: 'timestamptz', sensitivity: PUBLIC },
      { name: 'assigned_owner_id', type: 'uuid', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'sops',
    description: 'SOP metadata.',
    ownerScoped: false,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'name', type: 'varchar', sensitivity: PUBLIC },
      { name: 'active', type: 'boolean', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'sop_details',
    description: 'SOP version metadata (full text excluded).',
    ownerScoped: false,
    columns: [
      { name: 'sop_id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'version', type: 'integer', sensitivity: PUBLIC },
      { name: 'date_of_creation', type: 'timestamptz', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'users',
    description: 'Users (non-PII reference for ownership joins; no email/names).',
    ownerScoped: false,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'active', type: 'boolean', sensitivity: PUBLIC },
      { name: 'created_at', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
  {
    name: 'my_assigned_actions',
    description: 'Issue actions assigned to the acting subject (per-session owner-scoped).',
    ownerScoped: true,
    columns: [
      { name: 'id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'issue_id', type: 'uuid', sensitivity: PUBLIC },
      { name: 'title', type: 'varchar', sensitivity: PUBLIC },
      { name: 'status', type: 'text', sensitivity: PUBLIC },
      { name: 'created_date', type: 'timestamptz', sensitivity: PUBLIC },
    ],
  },
];

const VIEW_BY_NAME: ReadonlyMap<string, ViewDescriptor> = new Map(
  MCP_READ_VIEWS.map((view) => [view.name, view]),
);

/** True only for a relation that resolves to an allowlisted `mcp_read` view. */
export function isAllowedRelation(schema: string | undefined, relation: string): boolean {
  return schema === MCP_READ_SCHEMA && VIEW_BY_NAME.has(relation);
}

export function getView(name: string): ViewDescriptor | undefined {
  return VIEW_BY_NAME.get(name);
}

/** The set of column names classified as PII across all views (for redaction). */
export function piiColumnNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const view of MCP_READ_VIEWS) {
    for (const column of view.columns) {
      if (column.sensitivity === 'pii') {
        names.add(column.name);
      }
    }
  }
  return names;
}
