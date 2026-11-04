import {DEFINITION_DELETED, DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import {eq, sql} from 'drizzle-orm';
import type {WorkflowDefinitionPayload} from '#core/entities/workflow-definition.js';
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {db} from './db.js';
import {
  applyVcsDefinitionsBatch,
  findOrCreateWorkflowLineage,
  getDefinitionByConfigPath,
  getDefinitionById,
  getWorkflowLineageById,
  invalidateCache,
  listDefinitionsByProject,
  moveVcsDefinitionsToRef,
  softDeleteVcsDefinitionsNotIn,
  upsertDefinition,
} from './definitions.js';
import {workflowDefinitions} from './schema/definitions.js';
import {definitionsOutbox} from './schema/outbox.js';
import {workflowWorkflows} from './schema/workflows.js';

function definitionFields(name = 'Test Workflow'): WorkflowDefinitionPayload {
  const document = {
    name,
    runner: 'ubuntu-latest',
    jobs: {build: {steps: [{run: 'echo hello'}]}},
  };
  return definitionFieldsForDocument(document);
}

function definitionFieldsForDocument(
  document: WorkflowDefinitionPayload['document'],
): WorkflowDefinitionPayload {
  return {document, model: normalizeWorkflowDocument(document, {agentValidationCatalog})};
}

async function listOutboxRowsForProject(projectId: string) {
  return await db()
    .select()
    .from(definitionsOutbox)
    .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);
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
      expect({document: definition.document, model: definition.model}).toEqual(definitionFields());
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
        source: 'vcs',
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
        source: 'vcs',
        sha: 'abc123',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
        source: 'vcs',
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
        source: 'vcs',
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
        source: 'vcs',
        ref: 'main',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI v2',
        ...definitionFields('CI v2'),
        source: 'vcs',
        ref: 'main',
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe('CI v2');
    });

    test('manual and VCS definitions coexist at the same config_path (ENG-659)', async () => {
      const manual = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI (manual)',
        ...definitionFields('CI (manual)'),
        source: 'manual',
      });

      const vcs = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI (vcs)',
        ...definitionFields('CI (vcs)'),
        source: 'vcs',
        ref: 'main',
      });

      expect(vcs.id).not.toBe(manual.id);
      expect(manual.source).toBe('manual');
      expect(vcs.source).toBe('vcs');
    });

    test('VCS definitions on two branches coexist at the same config_path', async () => {
      const main = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI main',
        ...definitionFields('CI main'),
        source: 'vcs',
        ref: 'main',
      });

      const dev = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI dev',
        ...definitionFields('CI dev'),
        source: 'vcs',
        ref: 'dev',
      });

      expect(dev.id).not.toBe(main.id);
    });

    test('rejects a vcs definition with neither ref nor sha', async () => {
      const upsert = upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'vcs',
      });

      await expect(upsert).rejects.toThrow();
    });

    test('rejects a manual definition that sets a sha', async () => {
      const upsert = upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
        source: 'manual',
        sha: 'abc123',
      });

      await expect(upsert).rejects.toThrow();
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

  describe('workflow lineage', () => {
    test('upsertDefinition creates a lineage and returns its workflowId', async () => {
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/lineage.yml',
        name: 'Lineage',
        ...definitionFields('Lineage'),
        source: 'vcs',
        ref: 'main',
      });

      expect(definition.workflowId).toBeDefined();
      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
      expect(lineages[0]?.id).toBe(definition.workflowId);
      expect(lineages[0]?.configPath).toBe('.shipfox/workflows/lineage.yml');
    });

    test('re-syncing the same config path reuses the lineage', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'A v1',
        ...definitionFields('A v1'),
        source: 'vcs',
        ref: 'main',
      });

      const second = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'a.yml',
        name: 'A v2',
        ...definitionFields('A v2'),
        source: 'vcs',
        ref: 'main',
      });

      expect(second.workflowId).toBe(first.workflowId);
      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
    });

    test('manual and VCS rows at the same config path share one lineage', async () => {
      const manual = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'shared.yml',
        name: 'Shared manual',
        ...definitionFields('Shared manual'),
      });
      const vcs = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'shared.yml',
        name: 'Shared vcs',
        ...definitionFields('Shared vcs'),
        source: 'vcs',
        ref: 'main',
      });

      expect(vcs.workflowId).toBe(manual.workflowId);
    });

    test('applyVcsDefinitionsBatch creates the lineage and reuses it across syncs', async () => {
      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: 'batch.yml',
            name: 'Batch',
            ...definitionFields('Batch'),
            contentHash: 'h-1',
          },
        ],
      });
      const firstLineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(firstLineages).toHaveLength(1);

      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: 'batch.yml',
            name: 'Batch v2',
            ...definitionFields('Batch v2'),
            contentHash: 'h-2',
          },
        ],
      });
      const secondLineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(secondLineages).toHaveLength(1);
      expect(secondLineages[0]?.id).toBe(firstLineages[0]?.id);
    });

    test('applyVcsDefinitionsBatch stores the registry refs and refreshes them when the content is unchanged', async () => {
      const refs = [
        {kind: 'action' as const, package: 'shipfox/x', version: '1.0.0', steps: ['build.0']},
      ];
      const upsert = {
        configPath: 'refs.yml',
        name: 'Refs',
        ...definitionFields('Refs'),
        contentHash: 'h-refs',
      };
      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [{...upsert, registryRefs: refs}],
      });
      const stored = await getDefinitionByConfigPath({
        projectId,
        configPath: 'refs.yml',
        ref: 'main',
      });
      expect(stored?.registryRefs).toEqual(refs);

      // A re-sync with unchanged content still rewrites the refs, so an earlier sync cannot leave them stale.
      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [{...upsert, registryRefs: []}],
      });
      const refreshed = await getDefinitionByConfigPath({
        projectId,
        configPath: 'refs.yml',
        ref: 'main',
      });
      expect(refreshed?.registryRefs).toEqual([]);
    });

    test('soft-deleting a synced row keeps the lineage', async () => {
      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {configPath: 'gone.yml', name: 'Gone', ...definitionFields('Gone'), contentHash: 'h-1'},
        ],
      });

      const deletedCount = await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: [],
      });

      expect(deletedCount).toBe(1);
      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
      expect(lineages[0]?.configPath).toBe('gone.yml');
    });

    test('pathless manual definitions reuse the project lineage across saves', async () => {
      const first = await upsertDefinition({
        projectId,
        workspaceId,
        name: 'No path',
        ...definitionFields('No path'),
      });
      const second = await upsertDefinition({
        projectId,
        workspaceId,
        name: 'No path updated',
        ...definitionFields('No path updated'),
      });

      const lineage = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.id, first.workflowId));
      expect(lineage).toHaveLength(1);
      expect(lineage[0]?.projectId).toBe(projectId);
      expect(second.workflowId).toBe(first.workflowId);

      const projectLineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(projectLineages).toHaveLength(1);
    });

    test('materializes a legacy row when it is read', async () => {
      const legacyId = crypto.randomUUID();
      await db()
        .insert(workflowDefinitions)
        .values({
          id: legacyId,
          projectId,
          configPath: 'legacy.yml',
          name: 'Legacy',
          definition: definitionFields('Legacy'),
        });

      const definition = await getDefinitionById(legacyId);

      expect(definition?.workflowId).toBeDefined();
      const stored = await db()
        .select({workflowId: workflowDefinitions.workflowId})
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, legacyId));
      expect(stored[0]?.workflowId).toBe(definition?.workflowId);

      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
      expect(lineages[0]?.configPath).toBe('legacy.yml');
    });

    test('materializes legacy pathless rows into one project lineage', async () => {
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      await db()
        .insert(workflowDefinitions)
        .values([
          {
            id: firstId,
            projectId,
            configPath: null,
            name: 'Legacy one',
            definition: definitionFields('Legacy one'),
          },
          {
            id: secondId,
            projectId,
            configPath: null,
            name: 'Legacy two',
            definition: definitionFields('Legacy two'),
          },
        ]);

      const definitions = await listDefinitionsByProject(projectId);

      expect(definitions).toHaveLength(2);
      expect(definitions[0]?.workflowId).toBe(definitions[1]?.workflowId);
      const lineages = await db()
        .select()
        .from(workflowWorkflows)
        .where(eq(workflowWorkflows.projectId, projectId));
      expect(lineages).toHaveLength(1);
      expect(lineages[0]?.configPath).toBeNull();
    });

    test('materializes an unchanged legacy VCS row during sync', async () => {
      const legacyId = crypto.randomUUID();
      await db()
        .insert(workflowDefinitions)
        .values({
          id: legacyId,
          projectId,
          configPath: 'legacy-vcs.yml',
          source: 'vcs',
          ref: 'main',
          name: 'Legacy VCS',
          definition: definitionFields('Legacy VCS'),
          contentHash: 'legacy-hash',
        });

      const result = await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: 'legacy-vcs.yml',
            name: 'Legacy VCS',
            ...definitionFields('Legacy VCS'),
            contentHash: 'legacy-hash',
          },
        ],
      });

      expect(result.appliedCount).toBe(0);
      const stored = await db()
        .select({workflowId: workflowDefinitions.workflowId})
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, legacyId));
      expect(stored[0]?.workflowId).toBeDefined();
    });

    test('getDefinitionById returns the workflowId', async () => {
      const created = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'found.yml',
        name: 'Found',
        ...definitionFields('Found'),
      });

      const found = await getDefinitionById(created.id);

      expect(found?.workflowId).toBe(created.workflowId);
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

  describe('getWorkflowLineageById', () => {
    test('returns the lineage by its id, which differs from its definition row id', async () => {
      const created = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/ci.yml',
        name: 'CI',
        ...definitionFields('CI'),
      });

      const found = await getWorkflowLineageById(created.workflowId);

      expect(created.workflowId).not.toBe(created.id);
      expect(found).toEqual({
        id: created.workflowId,
        projectId,
        configPath: '.shipfox/workflows/ci.yml',
      });
      expect(await getWorkflowLineageById(created.id)).toBeUndefined();
    });
  });

  describe('getDefinitionByConfigPath', () => {
    test('returns the active synced definition for the requested branch', async () => {
      const main = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI main',
        ...definitionFields('CI main'),
        source: 'vcs',
        ref: 'main',
      });
      const dev = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'CI dev',
        ...definitionFields('CI dev'),
        source: 'vcs',
        ref: 'dev',
      });
      const result = await getDefinitionByConfigPath({
        projectId,
        configPath: 'ci.yml',
        ref: 'main',
      });

      expect(result).toMatchObject({
        id: main.id,
        workflowId: main.workflowId,
        name: 'CI main',
      });
      expect(result?.id).not.toBe(dev.id);
    });

    test('does not return an unknown path, manual definition, or dev-only lineage', async () => {
      await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'manual-only.yml',
        name: 'Manual only',
        ...definitionFields('Manual only'),
        source: 'manual',
      });
      await findOrCreateWorkflowLineage({projectId, configPath: 'dev-only.yml'});

      await expect(
        getDefinitionByConfigPath({projectId, configPath: 'missing.yml', ref: 'main'}),
      ).resolves.toBeUndefined();
      await expect(
        getDefinitionByConfigPath({projectId, configPath: 'manual-only.yml', ref: 'main'}),
      ).resolves.toBeUndefined();
      await expect(
        getDefinitionByConfigPath({projectId, configPath: 'dev-only.yml', ref: 'main'}),
      ).resolves.toBeUndefined();
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
      expect(restored.workflowId).toBe(original.workflowId);
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

      await db()
        .update(workflowDefinitions)
        .set({fetchedAt: new Date(0), updatedAt: new Date(0)})
        .where(eq(workflowDefinitions.projectId, projectId));

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

      const refreshed = (
        await db()
          .select()
          .from(workflowDefinitions)
          .where(eq(workflowDefinitions.projectId, projectId))
      ).find((row) => row.configPath === 'a.yml');
      expect(refreshed?.fetchedAt.getTime()).toBeGreaterThan(0);
      expect(refreshed?.updatedAt.getTime()).toBeGreaterThan(0);
    });

    test('softDeleteVcsDefinitionsNotIn writes a DEFINITION_DELETED event per pruned row', async () => {
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

  describe('moveVcsDefinitionsToRef', () => {
    async function upsertVcs(configPath: string, ref: string) {
      return await upsertDefinition({
        projectId,
        workspaceId,
        configPath,
        name: configPath,
        ...definitionFields(configPath),
        ref,
        source: 'vcs',
      });
    }

    test('moves live rows to the new ref and keeps their ids and lineage', async () => {
      const ci = await upsertVcs('ci.yml', 'master');
      const deploy = await upsertVcs('deploy.yml', 'master');

      const result = await moveVcsDefinitionsToRef({projectId, workspaceId, ref: 'main'});

      expect(result).toEqual({movedCount: 2, deletedCount: 0});
      const rows = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.projectId} = ${projectId}`);
      expect(rows.map((row) => [row.id, row.ref, row.workflowId, row.deletedAt]).sort()).toEqual(
        [
          [ci.id, 'main', ci.workflowId, null],
          [deploy.id, 'main', deploy.workflowId, null],
        ].sort(),
      );
      expect(
        await getDefinitionByConfigPath({projectId, configPath: 'ci.yml', ref: 'main'}),
      ).toMatchObject({id: ci.id});
    });

    test('soft-deletes the old row when the new ref already holds the path', async () => {
      const old = await upsertVcs('ci.yml', 'master');
      const current = await upsertVcs('ci.yml', 'main');
      const moved = await upsertVcs('only-old.yml', 'master');

      const result = await moveVcsDefinitionsToRef({projectId, workspaceId, ref: 'main'});

      expect(result).toEqual({movedCount: 1, deletedCount: 1});
      const live = await listDefinitionsByProject(projectId);
      expect(live.map((definition) => definition.id).sort()).toEqual([current.id, moved.id].sort());
      const [oldRow] = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.id} = ${old.id}`);
      expect(oldRow?.deletedAt).not.toBeNull();
      expect(oldRow?.ref).toBe('master');
    });

    test('soft-deletes the old row when the new ref holds the path as a deleted row', async () => {
      const old = await upsertVcs('ci.yml', 'master');
      await upsertVcs('ci.yml', 'main');
      await softDeleteVcsDefinitionsNotIn({
        projectId,
        workspaceId,
        ref: 'main',
        keepConfigPaths: [],
      });

      const result = await moveVcsDefinitionsToRef({projectId, workspaceId, ref: 'main'});

      expect(result).toEqual({movedCount: 0, deletedCount: 1});
      expect(await getDefinitionById(old.id)).toBeUndefined();
    });

    test('writes DEFINITION_DELETED only for the soft-deleted row', async () => {
      const old = await upsertVcs('ci.yml', 'master');
      await upsertVcs('ci.yml', 'main');
      const movedOnly = await upsertVcs('only-old.yml', 'master');
      await db()
        .delete(definitionsOutbox)
        .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`);

      await moveVcsDefinitionsToRef({projectId, workspaceId, ref: 'main'});

      const events = (await listOutboxRowsForProject(projectId)).map((event) => ({
        type: event.eventType,
        definitionId: (event.payload as {definitionId?: unknown}).definitionId,
      }));
      expect(events).toEqual([{type: DEFINITION_DELETED, definitionId: old.id}]);
      expect(events.some((event) => event.definitionId === movedOnly.id)).toBe(false);
    });

    test('moves every row once when two moves run at the same time', async () => {
      const rows = await Promise.all(
        ['a.yml', 'b.yml', 'c.yml', 'd.yml'].map((path) => upsertVcs(path, 'master')),
      );

      const results = await Promise.all([
        moveVcsDefinitionsToRef({projectId, workspaceId, ref: 'main'}),
        moveVcsDefinitionsToRef({projectId, workspaceId, ref: 'main'}),
      ]);

      expect(results.reduce((total, result) => total + result.movedCount, 0)).toBe(4);
      expect(results.reduce((total, result) => total + result.deletedCount, 0)).toBe(0);
      const live = await listDefinitionsByProject(projectId);
      expect(live.map((definition) => definition.id).sort()).toEqual(
        rows.map((row) => row.id).sort(),
      );
    });

    test('leaves rows already on the ref, manual rows, and other projects alone', async () => {
      const onRef = await upsertVcs('ci.yml', 'main');
      const manual = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: 'manual.yml',
        name: 'Manual',
        ...definitionFields('Manual'),
      });
      const otherProjectId = crypto.randomUUID();
      const other = await upsertDefinition({
        projectId: otherProjectId,
        workspaceId,
        configPath: 'ci.yml',
        name: 'Other',
        ...definitionFields('Other'),
        ref: 'master',
        source: 'vcs',
      });

      const result = await moveVcsDefinitionsToRef({projectId, workspaceId, ref: 'main'});

      expect(result).toEqual({movedCount: 0, deletedCount: 0});
      const rows = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.id} IN (${onRef.id}, ${manual.id}, ${other.id})`);
      expect(rows.find((row) => row.id === onRef.id)?.ref).toBe('main');
      expect(rows.find((row) => row.id === manual.id)?.ref).toBeNull();
      expect(rows.find((row) => row.id === other.id)?.ref).toBe('master');
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
        source: 'vcs',
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
        source: 'vcs',
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

    test('writes the authenticated actor to a manual resolved outbox event', async () => {
      const actorUserId = crypto.randomUUID();
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        actorUserId,
        configPath: '.shipfox/workflows/manual.yml',
        name: 'Manual',
        ...definitionFields('Manual'),
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.payload).toEqual({
        definitionId: definition.id,
        projectId: definition.projectId,
        workspaceId,
        actorUserId,
        configPath: definition.configPath,
        triggers: {},
      });
    });

    test('omits the actor from an automated VCS resolved outbox event', async () => {
      await applyVcsDefinitionsBatch({
        projectId,
        workspaceId,
        ref: 'main',
        upserts: [
          {
            configPath: '.shipfox/workflows/vcs.yml',
            name: 'VCS',
            ...definitionFields('VCS'),
            contentHash: 'vcs-content-hash',
          },
        ],
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.payload).not.toHaveProperty('actorUserId');
    });

    test('writes normalized trigger config to the resolved outbox event', async () => {
      const fields = definitionFieldsForDocument({
        name: 'Nightly',
        runner: 'ubuntu-latest',
        triggers: {
          nightly: {
            source: 'cron',
            event: 'tick',
            config: {schedule: '0 2 * * *'},
          },
        },
        jobs: {build: {steps: [{run: 'echo hello'}]}},
      });
      const definition = await upsertDefinition({
        projectId,
        workspaceId,
        configPath: '.shipfox/workflows/nightly.yml',
        name: 'Nightly',
        ...fields,
      });

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.payload).toMatchObject({
        definitionId: definition.id,
        triggers: {
          nightly: {
            source: 'cron',
            event: 'tick',
            config: {
              schedule: '0 2 * * *',
              timezone: 'UTC',
            },
          },
        },
      });
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
      const transaction = db().transaction(async (tx) => {
        await tx.insert(definitionsOutbox).values({
          eventType: DEFINITION_RESOLVED,
          payload: {definitionId: 'test', projectId, configPath: 'test'},
        });
        throw new Error('Simulated failure');
      });

      await expect(transaction).rejects.toThrow('Simulated failure');

      const outboxRows = await listOutboxRowsForProject(projectId);

      expect(outboxRows).toHaveLength(0);
    });
  });
});
