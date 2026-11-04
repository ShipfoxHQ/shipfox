import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {encodeActionBundle} from '@shipfox/workflow-document';
import {and, eq} from 'drizzle-orm';
import {getActionSnapshot, upsertActionSnapshot} from '#db/action-snapshots.js';
import {applyVcsAgentsBatch, listProjectAgents} from '#db/agents.js';
import {db} from '#db/db.js';
import {listDefinitionsByProject, upsertDefinition} from '#db/definitions.js';
import {definitionsDeletedScopes} from '#db/schema/deleted-scopes.js';
import {definitionSyncStates} from '#db/schema/sync-states.js';
import {workflowWorkflows} from '#db/schema/workflows.js';
import {getLatestDefinitionSyncState, markDefinitionSyncState} from '#db/sync-states.js';
import {definitionFactory} from '#test/factories/definition.js';
import {onProjectDeleted} from './on-project-deleted.js';

const MANIFEST = {name: 'Hello', main: 'index.ts'};

function deletedEvent(params: {workspaceId: string; projectId: string}) {
  return {
    ...params,
    deletedBy: crypto.randomUUID(),
    deletedAt: new Date().toISOString(),
  };
}

async function seedProject(params: {workspaceId: string; projectId: string}) {
  const {workspaceId, projectId} = params;
  await definitionFactory.create({projectId, configPath: 'a.yml'}, {transient: {workspaceId}});
  await definitionFactory.create({projectId, configPath: 'b.yml'}, {transient: {workspaceId}});
  await markDefinitionSyncState({
    workspaceId,
    projectId,
    sourceConnectionId: crypto.randomUUID(),
    sourceExternalRepositoryId: 'acme/app',
    ref: 'main',
    status: 'succeeded',
  });
  await applyVcsAgentsBatch({
    workspaceId,
    projectId,
    valid: [
      {
        key: 'triage',
        configPath: '.shipfox/agents/triage.yaml',
        name: null,
        description: 'Triage',
        instructions: 'Triage issues',
        document: {description: 'Triage', instructions: 'Triage issues'},
        contentHash: 'hash-triage',
      },
    ],
    invalid: [],
  });
}

async function storeSnapshot(params: {workspaceId: string; projectId: string; content: string}) {
  const bundle = await encodeActionBundle({files: [{path: 'index.ts', content: params.content}]});
  await upsertActionSnapshot({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    manifest: MANIFEST,
    bundle,
    source: 'vcs',
  });
  return bundle.digest;
}

describe('onProjectDeleted', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  it('deletes the workflows, definitions, sync states, and agents of the project', async () => {
    await seedProject({workspaceId, projectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    expect(await listDefinitionsByProject(projectId)).toEqual([]);
    expect(await listProjectAgents(projectId)).toEqual([]);
    const workflows = await db()
      .select()
      .from(workflowWorkflows)
      .where(eq(workflowWorkflows.projectId, projectId));
    expect(workflows).toEqual([]);
    const syncStates = await db()
      .select()
      .from(definitionSyncStates)
      .where(eq(definitionSyncStates.projectId, projectId));
    expect(syncStates).toEqual([]);
  });

  it('keeps the rows of another project', async () => {
    const otherProjectId = crypto.randomUUID();
    await seedProject({workspaceId, projectId});
    await seedProject({workspaceId, projectId: otherProjectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    expect(await listDefinitionsByProject(otherProjectId)).toHaveLength(2);
    expect(await listProjectAgents(otherProjectId)).toHaveLength(1);
  });

  it('records the marker and sets purged_at once nothing remains', async () => {
    await seedProject({workspaceId, projectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    const [marker] = await db()
      .select()
      .from(definitionsDeletedScopes)
      .where(
        and(
          eq(definitionsDeletedScopes.workspaceId, workspaceId),
          eq(definitionsDeletedScopes.projectId, projectId),
        ),
      );
    expect(marker).toMatchObject({reason: 'project_deleted'});
    expect(marker?.purgedAt).toBeInstanceOf(Date);
  });

  it('is safe to run again', async () => {
    await seedProject({workspaceId, projectId});
    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    const markers = await db()
      .select()
      .from(definitionsDeletedScopes)
      .where(eq(definitionsDeletedScopes.projectId, projectId));
    expect(markers).toHaveLength(1);
  });

  it('keeps the action snapshots of the project, because projects share them', async () => {
    const digest = await storeSnapshot({workspaceId, projectId, content: `a ${projectId}`});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    expect(await getActionSnapshot({workspaceId, digest})).toBeDefined();
  });

  describe('after the marker', () => {
    beforeEach(async () => {
      await onProjectDeleted(deletedEvent({workspaceId, projectId}));
    });

    it('refuses to save a definition', async () => {
      const definition = definitionFactory.build({projectId});

      await expect(
        upsertDefinition({
          workspaceId,
          projectId,
          configPath: 'late.yml',
          name: definition.name,
          document: definition.document,
          model: definition.model,
        }),
      ).rejects.toBeInstanceOf(ScopeDeletedError);
      expect(await listDefinitionsByProject(projectId)).toEqual([]);
    });

    it('refuses to record a sync state', async () => {
      const sourceConnectionId = crypto.randomUUID();

      await expect(
        markDefinitionSyncState({
          workspaceId,
          projectId,
          sourceConnectionId,
          sourceExternalRepositoryId: 'acme/app',
          ref: 'main',
          status: 'syncing',
        }),
      ).rejects.toBeInstanceOf(ScopeDeletedError);
      expect(
        await getLatestDefinitionSyncState({
          projectId,
          sourceConnectionId,
          sourceExternalRepositoryId: 'acme/app',
        }),
      ).toBeUndefined();
    });

    it('refuses to apply agents', async () => {
      await expect(
        applyVcsAgentsBatch({workspaceId, projectId, valid: [], invalid: []}),
      ).rejects.toBeInstanceOf(ScopeDeletedError);
    });

    it('refuses to store a snapshot', async () => {
      const bundle = await encodeActionBundle({
        files: [{path: 'index.ts', content: `late ${projectId}`}],
      });

      await expect(
        upsertActionSnapshot({workspaceId, projectId, manifest: MANIFEST, bundle, source: 'vcs'}),
      ).rejects.toBeInstanceOf(ScopeDeletedError);
    });
  });
});
