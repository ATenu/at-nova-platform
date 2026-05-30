import type { DataSource } from 'typeorm';

/** A column as surfaced to agents: enough to understand and query it safely. */
export interface ColumnDescription {
  readonly propertyName: string;
  readonly column: string;
  readonly type: string;
  readonly isPrimary: boolean;
  readonly isNullable: boolean;
  readonly isGenerated: boolean;
  readonly enumValues?: readonly string[];
}

export interface RelationDescription {
  readonly propertyName: string;
  readonly kind: string;
  readonly targetTable: string;
  readonly joinColumns: readonly string[];
}

export interface IndexDescription {
  readonly name: string;
  readonly columns: readonly string[];
  readonly isUnique: boolean;
}

export interface TableDescription {
  readonly entity: string;
  readonly table: string;
  readonly columns: readonly ColumnDescription[];
  readonly relations: readonly RelationDescription[];
  readonly indices: readonly IndexDescription[];
}

function normalizeColumnType(type: unknown): string {
  if (typeof type === 'string') {
    return type;
  }
  if (typeof type === 'function') {
    return (type as { name?: string }).name ?? 'unknown';
  }
  return 'unknown';
}

/**
 * Surface the database schema from TypeORM metadata so A2A agents can discover
 * tables, columns, relations, and indexes without raw catalog access. This is
 * the read-only core of the MCP data-surfacer and reuses the single shared
 * `@nova/database` model — no schema duplication.
 */
export function describeSchema(dataSource: DataSource): TableDescription[] {
  return dataSource.entityMetadatas.map((meta) => {
    const columns: ColumnDescription[] = meta.columns.map((col) => {
      const enumValues = col.enum?.map((value) => String(value));
      return {
        propertyName: col.propertyName,
        column: col.databaseName,
        type: normalizeColumnType(col.type),
        isPrimary: col.isPrimary,
        isNullable: col.isNullable,
        isGenerated: col.isGenerated,
        ...(enumValues && enumValues.length > 0 ? { enumValues } : {}),
      };
    });

    const relations: RelationDescription[] = meta.relations.map((rel) => ({
      propertyName: rel.propertyName,
      kind: rel.relationType,
      targetTable: rel.inverseEntityMetadata.tableName,
      joinColumns: rel.joinColumns.map((jc) => jc.databaseName),
    }));

    const indices: IndexDescription[] = meta.indices.map((idx) => ({
      name: idx.name,
      columns: idx.columns.map((col) => col.databaseName),
      isUnique: idx.isUnique,
    }));

    return { entity: meta.name, table: meta.tableName, columns, relations, indices };
  });
}
