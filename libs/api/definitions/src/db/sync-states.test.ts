import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {definitionSyncStates} from './schema/sync-states.js';
import {markDefinitionSyncState} from './sync-states.js';

describe('definition sync state queries', () => {
  let projectId: string;
  let sourceConnectionId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
  });

  it('creates a sync-state row', async () => {
    const state = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'debug-owner/platform',
      ref: 'main',
      status: 'syncing',
      startedAt: new Date(),
    });

    expect(state.projectId).toBe(projectId);
    expect(state.status).toBe('syncing');
    expect(state.lastErrorCode).toBeNull();
  });

  it('updates the same logical sync-state row', async () => {
    const first = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'debug-owner/platform',
      ref: 'main',
      status: 'syncing',
      startedAt: new Date(),
    });

    const second = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'debug-owner/platform',
      ref: 'main',
      status: 'failed',
      lastErrorCode: 'invalid-definition',
      lastErrorMessage: 'Invalid YAML',
      finishedAt: new Date(),
    });

    const rows = await db()
      .select()
      .from(definitionSyncStates)
      .where(eq(definitionSyncStates.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('failed');
    expect(second.lastErrorCode).toBe('invalid-definition');
    expect(second.startedAt?.getTime()).toBe(first.startedAt?.getTime());
  });

  it('clears stale finish data when a sync starts again', async () => {
    await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'debug-owner/platform',
      ref: 'main',
      status: 'failed',
      lastErrorCode: 'invalid-definition',
      lastErrorMessage: 'Invalid YAML',
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    const state = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'debug-owner/platform',
      ref: 'main',
      status: 'syncing',
      startedAt: new Date(),
      finishedAt: null,
    });

    expect(state.status).toBe('syncing');
    expect(state.lastErrorCode).toBeNull();
    expect(state.lastErrorMessage).toBeNull();
    expect(state.finishedAt).toBeNull();
  });
});
