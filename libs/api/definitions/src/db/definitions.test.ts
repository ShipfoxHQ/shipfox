import {DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import {
  type DrainedEvent,
  drainAll,
  markDispatched,
  registerPublisher,
  resetPublishers,
} from '@shipfox/node-module';
import {sql} from 'drizzle-orm';
import type {WorkflowDefinitionPayload} from '#core/entities/workflow-definition.js';
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {db} from './db.js';
import {
  applyVcsDefinitionsBatch,
  getDefinitionById,
  invalidateCache,
  listDefinitionsByProject,
  softDeleteVcsDefinitionsNotIn,
  upsertDefinition,
} from './definitions.js';
import {workflowDefinitions} from './schema/definitions.js';
import {definitionsOutbox} from './schema/outbox.js';

function definitionFields(name = 'Test Workflow'): WorkflowDefinitionPayload {
  const document = {
    name,
    jobs: {build: {steps: [{run: 'echo hello'}]}},
  };
  return {
    sourceYaml: `name: ${name}\njobs:\n  build:\n    steps:\n      - run: echo hello\n`,
    document,
    model: normalizeWorkflowDocument(document),
  };
}

async function listOutboxRowsForProject(projectId: string) {
  return await db()
    .select()
    .from(definitionsOutbox)
    .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
}

function eventsForProject(events: DrainedEvent[], projectId: string) {
  return events.filter((event) => {
    const payload = event.event.payload as {projectId?: unknown};
    return payload.projectId === projectId;
  });
}

describe('definition queries', () => {
  let projectId: string;
  let workspaceId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
  });

  describe('upsertDefinition', () => {
    test('inserts a new definition and returns entity with id and timestamps', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test',
        ...definitionFields(),
      });

      expect(definition.id).toBeDefined();
      expect(definition.projectId).toBe(projectId);
      expect(definition.configPath).toBe('.shipfox/workflows/test.yml');
      expect(definition.name).toBe('Test');
      expect({
        sourceYaml: definition.workflowSourceYaml,
        document: definition.document,
        model: definition.model,
      }).toEqual(definitionFields());
      expect(definition.sha).toBeNull();
      expect(definition.ref).toBeNull();
      expect(definition.fetchedAt).toBeInstanceOf(Date);
      expect(definition.createdAt).toBeInstanceOf(Date);
      expect(definition.updatedAt).toBeInstanceOf(Date);
    });

    test('updates existing definition on conflict (same project_id + config_path)', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/deploy.yml',
        name: 'Deploy v1',
        ...definitionFields('Deploy v1'),
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/deploy.yml',
        name: 'Deploy v2',
        ...definitionFields('Deploy v2'),
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Deploy v2');
      expect(second.document.name).toBe('Deploy v2');
      expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
      expect(second.updatedAt).not.toEqual(first.updatedAt);
    });

    test('with sha inserts SHA-pinned definition', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        sha: 'abc123',
      });

      expect(definition.sha).toBe('abc123');
      expect(definition.ref).toBeNull();
    });

    test('with sha updates on conflict (same projectId + sha + configPath)', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
        sha: 'abc123',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
        sha: 'abc123',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('with ref inserts ref-based definition', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        ref: 'main',
      });

      expect(definition.ref).toBe('main');
      expect(definition.sha).toBeNull();
    });

    test('with ref updates on conflict (same projectId + ref + configPath)', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
        ref: 'main',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
        ref: 'main',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('with neither sha nor ref uses base constraint', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('sets fetchedAt on insert', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
      });

      expect(definition.fetchedAt).toBeInstanceOf(Date);
    });

    test('updates fetchedAt on conflict update', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v1',
        ...definitionFields('CI v1'),
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
      });

      expect(second.fetchedAt.getTime()).toBeGreaterThanOrEqual(first.fetchedAt.getTime());
    });
  });

  describe('getDefinitionById', () => {
    test('returns the definition when found', async () => {
      const created = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
      });

      const found = await getDefinitionById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('CI');
    });

    test('returns undefined when not found', async () => {
      const found = await getDefinitionById(crypto.randomUUID());

      expect(found).toBeUndefined();
    });
  });

  describe('listDefinitionsByProject', () => {
    test('returns definitions ordered by name', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'z.yml',
        name: 'Zulu',
        ...definitionFields('Zulu'),
      });
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'Alpha',
        ...definitionFields('Alpha'),
      });
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'm.yml',
        name: 'Mike',
        ...definitionFields('Mike'),
      });

      const definitions = await listDefinitionsByProject(projectId);

      expect(definitions).toHaveLength(3);
      expect(definitions[0]?.name).toBe('Alpha');
      expect(definitions[1]?.name).toBe('Mike');
      expect(definitions[2]?.name).toBe('Zulu');
    });

    test('returns empty array for project with no definitions', async () => {
      const definitions = await listDefinitionsByProject(crypto.randomUUID());

      expect(definitions).toEqual([]);
    });
  });

  describe('soft-delete + restore', () => {
    test('soft-deletes VCS definitions for a ref that are not in the keep set', async () => {
      const stale = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'old.yml',
        name: 'Old',
        ...definitionFields('Old'),
        ref: 'main',
        source: 'vcs',
      });
      const kept = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'kept.yml',
        name: 'Kept',
        ...definitionFields('Kept'),
        ref: 'main',
        source: 'vcs',
      });

      const deletedCount = await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: ['kept.yml'],
      });

      expect(deletedCount).toBe(1);
      const after = await listDefinitionsByProject(projectId);
      expect(after.map((definition) => definition.id)).toEqual([kept.id]);
      const staleRow = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.id} = ${stale.id}`);
      expect(staleRow[0]?.deletedAt).not.toBeNull();
    });

    test('reactivates a previously soft-deleted definition by clearing deleted_at on next upsert', async () => {
      const original = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'recovered.yml',
        name: 'Recovered v1',
        ...definitionFields('Recovered v1'),
        ref: 'main',
        source: 'vcs',
      });
      await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: [],
      });

      const restored = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'recovered.yml',
        name: 'Recovered v2',
        ...definitionFields('Recovered v2'),
        ref: 'main',
        source: 'vcs',
      });

      expect(restored.id).toBe(original.id);
      expect(restored.name).toBe('Recovered v2');
      expect(restored.deletedAt).toBeNull();
      const visible = await listDefinitionsByProject(projectId);
      expect(visible.map((definition) => definition.id)).toEqual([restored.id]);
    });

    test('applyVcsDefinitionsBatch upserts and soft-deletes in a single transaction', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'orphaned.yml',
        name: 'Orphan',
        ...definitionFields('Orphan'),
        ref: 'main',
        source: 'vcs',
      });

      const result = await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: 'kept.yml',
            name: 'Kept',
            ...definitionFields('Kept'),
            contentHash: 'h-kept',
          },
          {configPath: 'new.yml', name: 'New', ...definitionFields('New'), contentHash: 'h-new'},
        ],
      });

      expect(result).toEqual({appliedCount: 2, deletedCount: 1});
      const visible = await listDefinitionsByProject(projectId);
      expect(visible.map((definition) => definition.configPath).sort()).toEqual([
        'kept.yml',
        'new.yml',
      ]);
    });

    test('applyVcsDefinitionsBatch skips outbox events for unchanged content hashes', async () => {
      await db().execute(sql`TRUNCATE definitions_outbox CASCADE`);

      const first = await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {configPath: 'a.yml', name: 'A', ...definitionFields('A'), contentHash: 'h-a-v1'},
          {configPath: 'b.yml', name: 'B', ...definitionFields('B'), contentHash: 'h-b-v1'},
        ],
      });

      expect(first.appliedCount).toBe(2);
      expect(await listOutboxRowsForProject(projectId)).toHaveLength(2);

      const second = await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {configPath: 'a.yml', name: 'A', ...definitionFields('A'), contentHash: 'h-a-v1'},
          {configPath: 'b.yml', name: 'B v2', ...definitionFields('B v2'), contentHash: 'h-b-v2'},
        ],
      });

      expect(second.appliedCount).toBe(1);
      expect(await listOutboxRowsForProject(projectId)).toHaveLength(3);
    });

    test('softDeleteVcsDefinitionsNotIn writes a DEFINITION_DELETED event per pruned row', async () => {
      await db().execute(sql`TRUNCATE definitions_outbox CASCADE`);
      const pruned = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'orphan.yml',
        name: 'Orphan',
        ...definitionFields('Orphan'),
        ref: 'main',
        source: 'vcs',
      });

      const deletedCount = await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: [],
      });

      expect(deletedCount).toBe(1);
      const outboxRows = await listOutboxRowsForProject(projectId);
      const deletedEvents = outboxRows.filter(
        (row) => row.eventType === 'definitions.definition.deleted',
      );
      expect(deletedEvents).toHaveLength(1);
      expect(deletedEvents[0]?.payload).toEqual({
        definitionId: pruned.id,
        projectId,
        workspaceId,
      });
    });
  });

  describe('invalidateCache', () => {
    test('deletes ref-based entries for matching project and ref', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        ref: 'main',
      });

      await invalidateCache({projectId, ref: 'main'});

      const found = await getDefinitionById(definition.id);
      expect(found).toBeUndefined();
    });

    test('does not delete SHA-pinned entries', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        sha: 'abc123',
      });

      await invalidateCache({projectId, ref: 'main'});

      const found = await getDefinitionById(definition.id);
      expect(found).toBeDefined();
    });

    test('is a no-op when no matching entries exist', async () => {
      await invalidateCache({projectId: crypto.randomUUID(), ref: 'main'});
    });
  });

  describe('outbox integration', () => {
    beforeEach(async () => {
      await db().execute(sql`TRUNCATE definitions_outbox CASCADE`);
    });

    test('writes a definitions.definition.resolved event to the outbox', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test',
        ...definitionFields(),
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.eventType).toBe(DEFINITION_RESOLVED);
      expect(outboxRows[0]?.payload).toEqual({
        definitionId: definition.id,
        projectId: definition.projectId,
        workspaceId,
        configPath: definition.configPath,
        triggers: {},
      });
      expect(outboxRows[0]?.dispatchedAt).toBeNull();
    });

    test('writes one outbox event per upsert call', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test v1',
        ...definitionFields('v1'),
      });

      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/test.yml',
        name: 'Test v2',
        ...definitionFields('v2'),
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(2);
    });

    test('rolls back the outbox event when the transaction fails', async () => {
      try {
        await db().transaction(async (tx) => {
          await tx.insert(definitionsOutbox).values({
            eventType: DEFINITION_RESOLVED,
            payload: {definitionId: 'test', projectId, configPath: 'test'},
          });
          throw new Error('Simulated failure');
        });
      } catch {
        // expected
      }

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(0);
    });
  });

  describe('publisher registry (drainAll + markDispatched)', () => {
    beforeEach(async () => {
      resetPublishers();
      await db().execute(sql`TRUNCATE definitions_outbox CASCADE`);
      registerPublisher({
        name: 'definitions',
        table: definitionsOutbox,
        db: () => db(),
      });
    });

    afterEach(() => {
      resetPublishers();
    });

    test('drainAll returns undispatched outbox events', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'test.yml',
        name: 'Test',
        ...definitionFields(),
      });

      const events = await drainAll();
      const projectEvents = eventsForProject(events, projectId);

      expect(projectEvents).toHaveLength(1);
      expect(projectEvents[0]?.source).toBe('definitions');
      expect(projectEvents[0]?.event.type).toBe(DEFINITION_RESOLVED);
    });

    test('markDispatched sets dispatchedAt for a single event', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'test.yml',
        name: 'Test',
        ...definitionFields(),
      });
      const events = eventsForProject(await drainAll(), projectId);

      await markDispatched('definitions', [events[0]?.id as string]);

      const rows = await listOutboxRowsForProject(projectId);
      const dispatched = rows.filter((row) => row.dispatchedAt !== null);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]?.id).toBe(events[0]?.id);
    });

    test('markDispatched sets dispatchedAt for multiple events', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'A',
        ...definitionFields('A'),
      });
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'b.yml',
        name: 'B',
        ...definitionFields('B'),
      });
      const events = eventsForProject(await drainAll(), projectId);
      const ids = events.map((e) => e.id);

      await markDispatched('definitions', ids);

      const rows = await listOutboxRowsForProject(projectId);
      const pending = rows.filter((row) => row.dispatchedAt === null);
      expect(pending).toHaveLength(0);
    });

    test('drainAll skips already-dispatched events', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'test.yml',
        name: 'Test',
        ...definitionFields(),
      });
      const events = eventsForProject(await drainAll(), projectId);
      await markDispatched('definitions', [events[0]?.id as string]);

      const secondDrain = eventsForProject(await drainAll(), projectId);

      expect(secondDrain).toHaveLength(0);
    });
  });
});
