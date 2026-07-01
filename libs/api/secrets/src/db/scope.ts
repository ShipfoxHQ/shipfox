import {and, eq, isNull, or, type SQL, sql} from 'drizzle-orm';
import type {PgColumn} from 'drizzle-orm/pg-core';

export interface StoreScope {
  projectId?: string | null | undefined;
}

export interface ScopeColumns {
  workspaceId: PgColumn;
  projectId: PgColumn;
  namespace: PgColumn;
  key: PgColumn;
}

export function normalizedProjectId(scope?: StoreScope | undefined): string | null {
  return scope?.projectId ?? null;
}

export function scopeConflictTargetWhere(scope?: StoreScope | undefined): SQL {
  return normalizedProjectId(scope) !== null
    ? sql`"project_id" IS NOT NULL`
    : sql`"project_id" IS NULL`;
}

export function scopeExactWhere(columns: ScopeColumns, params: StoreScope): SQL | undefined {
  const projectId = normalizedProjectId(params);
  return projectId !== null ? eq(columns.projectId, projectId) : isNull(columns.projectId);
}

export function lookupWithPrecedenceWhere(
  columns: ScopeColumns,
  params: StoreScope & {workspaceId: string; namespace: string; key: string},
): SQL | undefined {
  const base = and(
    eq(columns.workspaceId, params.workspaceId),
    eq(columns.namespace, params.namespace),
    eq(columns.key, params.key),
  );
  const projectId = normalizedProjectId(params);
  if (projectId === null) return and(base, isNull(columns.projectId));
  return and(base, or(eq(columns.projectId, projectId), isNull(columns.projectId)));
}
