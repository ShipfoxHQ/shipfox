import {DEFINITION_RESOLVED, type DefinitionsEventMap} from '@shipfox/api-definitions-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, asc, eq, isNull, notInArray, sql} from 'drizzle-orm';
import type {WorkflowDefinition, WorkflowSpec} from '#core/entities/definition.js';
import {db} from './db.js';
import {toDefinition, workflowDefinitions} from './schema/definitions.js';
import {definitionsOutbox} from './schema/outbox.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface UpsertDefinitionParams {
  projectId: string;
  configPath?: string | null | undefined;
  source?: 'manual' | 'vcs' | undefined;
  name: string;
  definition: WorkflowSpec;
  sha?: string | undefined;
  ref?: string | undefined;
}

function buildUpsertQuery(tx: Tx, params: UpsertDefinitionParams) {
  const source = params.source ?? 'manual';
  if (source === 'vcs' && !params.configPath) {
    throw new Error('configPath is required for VCS definitions');
  }

  const set = {
    name: params.name,
    source,
    definition: params.definition,
    fetchedAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const values = {
    projectId: params.projectId,
    configPath: params.configPath ?? null,
    source,
    sha: params.sha ?? null,
    ref: params.ref ?? null,
    name: params.name,
    definition: params.definition,
  };

  if (params.sha) {
    return tx
      .insert(workflowDefinitions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          workflowDefinitions.projectId,
          workflowDefinitions.sha,
          workflowDefinitions.configPath,
        ],
        targetWhere: sql`"sha" IS NOT NULL`,
        set,
      })
      .returning();
  }

  if (params.ref) {
    return tx
      .insert(workflowDefinitions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          workflowDefinitions.projectId,
          workflowDefinitions.ref,
          workflowDefinitions.configPath,
        ],
        targetWhere: sql`"ref" IS NOT NULL`,
        set,
      })
      .returning();
  }

  return tx
    .insert(workflowDefinitions)
    .values(values)
    .onConflictDoUpdate({
      target: [workflowDefinitions.projectId, workflowDefinitions.configPath],
      targetWhere: sql`"config_path" IS NOT NULL`,
      set,
    })
    .returning();
}

export async function upsertDefinition(
  params: UpsertDefinitionParams,
): Promise<WorkflowDefinition> {
  return await db().transaction(async (tx) => {
    const rows = await buildUpsertQuery(tx, params);
    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');

    await writeOutboxEvent<DefinitionsEventMap>(tx, definitionsOutbox, {
      type: DEFINITION_RESOLVED,
      payload: {definitionId: row.id, projectId: row.projectId, configPath: row.configPath},
    });

    return toDefinition(row);
  });
}

export async function getDefinitionById(id: string): Promise<WorkflowDefinition | undefined> {
  const rows = await db()
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, id), isNull(workflowDefinitions.deletedAt)))
    .limit(1);
  const row = rows[0];

  if (!row) return undefined;
  return toDefinition(row);
}

export async function listDefinitionsByProject(projectId: string): Promise<WorkflowDefinition[]> {
  const rows = await db()
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.projectId, projectId), isNull(workflowDefinitions.deletedAt)))
    .orderBy(asc(workflowDefinitions.name));

  return rows.map(toDefinition);
}

export interface SoftDeleteVcsDefinitionsParams {
  projectId: string;
  ref: string;
  keepConfigPaths: string[];
}

async function softDeleteVcsDefinitionsNotInTx(
  tx: Tx,
  params: SoftDeleteVcsDefinitionsParams,
): Promise<number> {
  const now = new Date();
  const baseWhere = and(
    eq(workflowDefinitions.projectId, params.projectId),
    eq(workflowDefinitions.source, 'vcs'),
    eq(workflowDefinitions.ref, params.ref),
    isNull(workflowDefinitions.deletedAt),
  );
  const where =
    params.keepConfigPaths.length > 0
      ? and(baseWhere, notInArray(workflowDefinitions.configPath, params.keepConfigPaths))
      : baseWhere;

  const rows = await tx
    .update(workflowDefinitions)
    .set({deletedAt: now, updatedAt: now})
    .where(where)
    .returning({id: workflowDefinitions.id});

  return rows.length;
}

export async function softDeleteVcsDefinitionsNotIn(
  params: SoftDeleteVcsDefinitionsParams,
): Promise<number> {
  return await db().transaction((tx) => softDeleteVcsDefinitionsNotInTx(tx, params));
}

export interface ApplyVcsDefinitionsBatchParams {
  projectId: string;
  ref: string;
  upserts: Array<{configPath: string; name: string; definition: WorkflowSpec}>;
}

export interface ApplyVcsDefinitionsBatchResult {
  appliedCount: number;
  deletedCount: number;
}

export async function applyVcsDefinitionsBatch(
  params: ApplyVcsDefinitionsBatchParams,
): Promise<ApplyVcsDefinitionsBatchResult> {
  return await db().transaction(async (tx) => {
    let appliedCount = 0;
    for (const item of params.upserts) {
      const rows = await buildUpsertQuery(tx, {
        projectId: params.projectId,
        configPath: item.configPath,
        source: 'vcs',
        ref: params.ref,
        name: item.name,
        definition: item.definition,
      });
      const row = rows[0];
      if (!row) throw new Error('Upsert returned no rows');

      await writeOutboxEvent<DefinitionsEventMap>(tx, definitionsOutbox, {
        type: DEFINITION_RESOLVED,
        payload: {definitionId: row.id, projectId: row.projectId, configPath: row.configPath},
      });
      appliedCount += 1;
    }

    const keepConfigPaths = params.upserts.map((upsert) => upsert.configPath);
    const deletedCount = await softDeleteVcsDefinitionsNotInTx(tx, {
      projectId: params.projectId,
      ref: params.ref,
      keepConfigPaths,
    });

    return {appliedCount, deletedCount};
  });
}

export async function invalidateCache(params: {projectId: string; ref: string}): Promise<void> {
  await db()
    .delete(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.projectId, params.projectId),
        eq(workflowDefinitions.ref, params.ref),
      ),
    );
}
