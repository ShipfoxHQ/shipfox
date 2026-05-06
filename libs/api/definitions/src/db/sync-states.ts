import type {
  DefinitionSyncErrorCode,
  DefinitionSyncState,
  DefinitionSyncStatus,
} from '#core/entities/sync-state.js';
import {db} from './db.js';
import {definitionSyncStates, toDefinitionSyncState} from './schema/sync-states.js';

export interface DefinitionSyncStateKey {
  projectId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  ref: string;
}

export interface MarkDefinitionSyncParams extends DefinitionSyncStateKey {
  status: DefinitionSyncStatus;
  lastErrorCode?: DefinitionSyncErrorCode | null | undefined;
  lastErrorMessage?: string | null | undefined;
  startedAt?: Date | null | undefined;
  finishedAt?: Date | null | undefined;
}

export async function markDefinitionSyncState(
  params: MarkDefinitionSyncParams,
): Promise<DefinitionSyncState> {
  const now = new Date();
  const [row] = await db()
    .insert(definitionSyncStates)
    .values({
      projectId: params.projectId,
      sourceConnectionId: params.sourceConnectionId,
      sourceExternalRepositoryId: params.sourceExternalRepositoryId,
      ref: params.ref,
      status: params.status,
      lastErrorCode: params.lastErrorCode ?? null,
      lastErrorMessage: params.lastErrorMessage ?? null,
      startedAt: params.startedAt ?? null,
      finishedAt: params.finishedAt ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        definitionSyncStates.projectId,
        definitionSyncStates.sourceConnectionId,
        definitionSyncStates.sourceExternalRepositoryId,
        definitionSyncStates.ref,
      ],
      set: {
        status: params.status,
        lastErrorCode: params.lastErrorCode ?? null,
        lastErrorMessage: params.lastErrorMessage ?? null,
        ...(params.startedAt !== undefined ? {startedAt: params.startedAt} : {}),
        ...(params.finishedAt !== undefined ? {finishedAt: params.finishedAt} : {}),
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Definition sync state upsert returned no rows');
  return toDefinitionSyncState(row);
}
