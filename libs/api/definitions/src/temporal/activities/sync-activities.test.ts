import {
  DEFINITION_RESOLVED,
  DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT,
} from '@shipfox/api-definitions-dto';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {isErrorReported} from '@shipfox/node-error-monitoring';
import {createTestFeatureFlags} from '@shipfox/node-feature-flags/testing';
import {ApplicationFailure} from '@temporalio/common';
import {sql} from 'drizzle-orm';
import type {DefinitionsSourceControl} from '#core/integrations.js';
import {
  db,
  definitionSyncStates,
  definitionsOutbox,
  getActionSnapshot,
  listProjectAgents,
} from '#db/index.js';
import {workflowDefinitions} from '#db/schema/definitions.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {createDefinitionSyncActivities} from './sync-activities.js';

const getValidationCatalogV2 = vi.fn(() => agentValidationCatalog);
const agent = {getValidationCatalogV2} as never;

const SOURCE_REPOSITORY_ID = 'gitea:gitea-owner/platform';

function projectsClient(
  source: {sourceConnectionId: string; sourceExternalRepositoryId: string} | null,
) {
  return {
    getProjectById: vi.fn(({projectId}: {projectId: string}) =>
      Promise.resolve({
        project:
          source === null
            ? null
            : {id: projectId, workspaceId: crypto.randomUUID(), name: 'Project', ...source},
      }),
    ),
  };
}

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({heartbeat: vi.fn()}),
  },
}));

const validYaml = `
name: CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: pnpm test
`;

const warningEventInterpolation = '$'.concat('{{ event.x }}');
const warningYaml = [
  'name: Warning only',
  'runner: ubuntu-latest',
  'jobs:',
  '  build:',
  '    steps:',
  '      - env:',
  `          MSG: '${warningEventInterpolation}'`,
  '        run: eval "$MSG"',
].join('\n');

const invalidPredicateYaml = [
  'name: Invalid predicate',
  'runner: ubuntu-latest',
  'jobs:',
  '  build:',
  "    success: 'executions.size()'",
  '    steps:',
  '      - run: echo hello',
].join('\n');

function sourceControl(
  overrides: Partial<DefinitionsSourceControl> = {},
): DefinitionsSourceControl {
  return {
    resolveRepository: vi.fn(() =>
      Promise.resolve({
        connection: {
          id: 'connection-1',
          workspaceId: 'workspace-1',
          provider: 'gitea',
          externalAccountId: 'gitea-owner',
          slug: 'gitea_owner',
          displayName: 'Gitea',
          lifecycleStatus: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        repository: {
          externalRepositoryId: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          fullName: 'gitea-owner/platform',
          defaultBranch: 'main',
          visibility: 'private' as const,
          cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
          htmlUrl: 'https://gitea.local/gitea-owner/platform',
        },
      }),
    ),
    listFiles: vi.fn(() =>
      Promise.resolve({
        files: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: validYaml.length}],
        nextCursor: null,
      }),
    ),
    fetchFile: vi.fn(() =>
      Promise.resolve({path: '.shipfox/workflows/ci.yml', ref: 'main', content: validYaml}),
    ),
    ...overrides,
  };
}

describe('definition sync activities', () => {
  let projectId: string;
  let sourceConnectionId: string;
  let projects: ReturnType<typeof projectsClient>;

  beforeEach(() => {
    projectId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    projects = projectsClient({
      sourceConnectionId,
      sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
    });
  });

  describe('prepareDefinitionSync', () => {
    it('marks the sync state as syncing and returns the resolved ref', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);

      const result = await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      expect(result).toEqual({sourceRef: 'main', sourceCommitSha: undefined});
      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('syncing');
      expect(rows[0]?.ref).toBe('main');
    });

    it('keeps source ref and source commit sha separate for commit-triggered sync', async () => {
      const source = sourceControl();
      const activities = createDefinitionSyncActivities(source, agent, projects);

      const result = await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        sourceCommitSha: 'abc123',
      });

      expect(result).toEqual({sourceRef: 'main', sourceCommitSha: 'abc123'});
      expect(source.resolveRepository).not.toHaveBeenCalled();
      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.ref).toBe('main');
    });

    it('translates retryable resolveRepository failures into retryable ApplicationFailures', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          resolveRepository: vi.fn(() => {
            return Promise.reject(new Error('temporary outage'));
          }),
        }),
        agent,
        projects,
      );

      const result = activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(result).rejects.toMatchObject({
        nonRetryable: false,
        type: 'unknown',
        message: 'temporary outage',
      });
      const error = await result.catch((error: unknown) => error);
      expect(isErrorReported(error)).toBe(false);
    });

    it('preserves retryable provider error codes for workflow-level failure persistence', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          resolveRepository: vi.fn(() => {
            return Promise.reject(
              createInterModuleKnownError(
                integrationsInterModuleContract.methods.resolveSourceRepository,
                'provider-failure',
                {reason: 'timeout'},
              ),
            );
          }),
        }),
        agent,
        projects,
      );

      const result = activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      await expect(result).rejects.toMatchObject({
        nonRetryable: false,
        type: 'provider-timeout',
        message: 'integrations.resolveSourceRepository: provider-failure',
      });
      const error = await result.catch((error: unknown) => error);
      expect(isErrorReported(error)).toBe(true);
    });

    describe('when the project source changed', () => {
      async function seedDefinitionOnRef(ref: string) {
        const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);
        const workspaceId = crypto.randomUUID();
        await activities.fetchAndApplyDefinitionWorkflows({
          projectId,
          workspaceId,
          sourceConnectionId,
          sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
          sourceRef: ref,
          paths: ['.shipfox/workflows/ci.yml'],
        });
        return workspaceId;
      }

      async function definitionRows() {
        return await db()
          .select({
            id: workflowDefinitions.id,
            ref: workflowDefinitions.ref,
            deletedAt: workflowDefinitions.deletedAt,
          })
          .from(workflowDefinitions)
          .where(sql`${workflowDefinitions.projectId} = ${projectId}`);
      }

      it('keeps definition ids when the default branch is renamed', async () => {
        const workspaceId = await seedDefinitionOnRef('master');
        const before = await definitionRows();
        const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);

        await activities.prepareDefinitionSync({
          projectId,
          workspaceId,
          sourceConnectionId,
          sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        });

        const after = await definitionRows();
        expect(after).toEqual([{id: before[0]?.id, ref: 'main', deletedAt: null}]);
      });

      it('moves no rows when the project points at another repository', async () => {
        const workspaceId = await seedDefinitionOnRef('master');
        const before = await definitionRows();
        const moved = projectsClient({
          sourceConnectionId,
          sourceExternalRepositoryId: 'github:acme/config',
        });
        const activities = createDefinitionSyncActivities(sourceControl(), agent, moved);

        await activities.prepareDefinitionSync({
          projectId,
          workspaceId,
          sourceConnectionId,
          sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        });

        expect(await definitionRows()).toEqual(before);
      });

      it('moves no rows when the project points at another connection', async () => {
        const workspaceId = await seedDefinitionOnRef('master');
        const before = await definitionRows();
        const moved = projectsClient({
          sourceConnectionId: crypto.randomUUID(),
          sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        });
        const activities = createDefinitionSyncActivities(sourceControl(), agent, moved);

        await activities.prepareDefinitionSync({
          projectId,
          workspaceId,
          sourceConnectionId,
          sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        });

        expect(await definitionRows()).toEqual(before);
      });

      it('moves no rows when the project no longer exists', async () => {
        const workspaceId = await seedDefinitionOnRef('master');
        const before = await definitionRows();
        const activities = createDefinitionSyncActivities(
          sourceControl(),
          agent,
          projectsClient(null),
        );

        await activities.prepareDefinitionSync({
          projectId,
          workspaceId,
          sourceConnectionId,
          sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        });

        expect(await definitionRows()).toEqual(before);
      });
    });
  });

  describe('discoverDefinitionWorkflows', () => {
    it('uses the configured workflow path', async () => {
      const source = sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [{path: '.shipfox/staging/workflows/ci.yml', type: 'file' as const, size: 64}],
            nextCursor: null,
          }),
        ),
      });
      const activities = createDefinitionSyncActivities(source, agent, projects, undefined, {
        workflowPath: '.shipfox/staging/workflows/',
      });

      const result = await activities.discoverDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
      });

      expect(result.paths).toEqual(['.shipfox/staging/workflows/ci.yml']);
      expect(source.listFiles).toHaveBeenCalledWith(
        expect.objectContaining({prefix: '.shipfox/staging/workflows/'}),
      );
    });
  });

  describe('discoverDefinitionFiles', () => {
    function repositoryListing(paths: string[]) {
      return vi.fn(({prefix}: {prefix: string}) =>
        Promise.resolve({
          files: paths
            .filter((path) => path.startsWith(prefix))
            .map((path) => ({path, type: 'file' as const, size: 64})),
          nextCursor: null,
        }),
      );
    }
    const input = () => ({
      projectId,
      workspaceId: crypto.randomUUID(),
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      sourceRef: 'main',
    });

    it('lists workflow and agent files, nested agent files included', async () => {
      const source = sourceControl({
        listFiles: repositoryListing([
          '.shipfox/workflows/ci.yml',
          '.shipfox/agents/shippy.yaml',
          '.shipfox/agents/team/reviewer.yaml',
          '.shipfox/agents/README.md',
        ]),
      });
      const activities = createDefinitionSyncActivities(source, agent, projects);

      const result = await activities.discoverDefinitionFiles(input());

      expect(result).toEqual({
        workflowPaths: ['.shipfox/workflows/ci.yml'],
        agentPaths: ['.shipfox/agents/shippy.yaml', '.shipfox/agents/team/reviewer.yaml'],
      });
    });

    it('accepts a repository with only agent files', async () => {
      const source = sourceControl({listFiles: repositoryListing(['.shipfox/agents/shippy.yaml'])});
      const activities = createDefinitionSyncActivities(source, agent, projects);

      const result = await activities.discoverDefinitionFiles(input());

      expect(result).toEqual({workflowPaths: [], agentPaths: ['.shipfox/agents/shippy.yaml']});
    });

    it('fails with no-workflow-files when both folders are empty', async () => {
      const source = sourceControl({listFiles: repositoryListing([])});
      const activities = createDefinitionSyncActivities(source, agent, projects);

      await expect(activities.discoverDefinitionFiles(input())).rejects.toMatchObject({
        type: 'no-workflow-files',
        nonRetryable: true,
      });
    });
  });

  describe('fetchAndApplyDefinitionAgents', () => {
    const shippyPath = '.shipfox/agents/shippy.yaml';
    const reviewerPath = '.shipfox/agents/reviewer.yaml';
    const reviewerYaml = 'description: Reviews.\ninstructions: Review the change.\n';

    function repositorySource(repository: Record<string, string>) {
      return sourceControl({
        fetchFile: vi.fn(({path, ref}: {path: string; ref: string}) =>
          Promise.resolve({path, ref, content: repository[path] ?? ''}),
        ),
      });
    }

    function sync(activities: ReturnType<typeof createDefinitionSyncActivities>, paths: string[]) {
      return activities.fetchAndApplyDefinitionAgents({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        sourceRef: 'main',
        paths,
      });
    }

    it('stores valid agents, keeps the last valid version of an invalid one, and deletes the rest', async () => {
      const first = createDefinitionSyncActivities(
        repositorySource({[shippyPath]: 'instructions: Be short.', [reviewerPath]: reviewerYaml}),
        agent,
        projects,
      );
      expect(await sync(first, [shippyPath, reviewerPath])).toEqual({
        appliedCount: 2,
        deletedCount: 0,
        diagnostics: [],
      });

      const second = createDefinitionSyncActivities(
        repositorySource({[reviewerPath]: 'name: Broken'}),
        agent,
        projects,
      );
      const result = await sync(second, [reviewerPath]);

      expect(result).toMatchObject({appliedCount: 0, deletedCount: 1});
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'agent-file-invalid',
          filePath: reviewerPath,
          severity: 'error',
        }),
        expect.objectContaining({
          code: 'agent-file-invalid',
          filePath: reviewerPath,
          severity: 'error',
        }),
      ]);
      const agents = await listProjectAgents(projectId);
      expect(agents).toEqual([
        expect.objectContaining({
          key: 'reviewer',
          instructions: 'Review the change.',
          lastError: expect.objectContaining({message: 'A custom agent requires "description".'}),
        }),
      ]);
    });

    it('creates no agent for a nested file and reports it', async () => {
      const nested = '.shipfox/agents/team/reviewer.yaml';
      const activities = createDefinitionSyncActivities(
        repositorySource({[nested]: reviewerYaml}),
        agent,
        projects,
      );

      const result = await sync(activities, [nested]);

      expect(result).toMatchObject({appliedCount: 0, deletedCount: 0});
      expect(result.diagnostics).toEqual([
        expect.objectContaining({filePath: nested, message: expect.stringContaining('is nested')}),
      ]);
      expect(await listProjectAgents(projectId)).toEqual([]);
    });

    it('changes nothing when the project points at another source', async () => {
      const current = createDefinitionSyncActivities(
        repositorySource({[reviewerPath]: reviewerYaml}),
        agent,
        projects,
      );
      await sync(current, [reviewerPath]);
      const before = await listProjectAgents(projectId);
      const superseded = createDefinitionSyncActivities(
        repositorySource({[shippyPath]: ''}),
        agent,
        projectsClient({sourceConnectionId, sourceExternalRepositoryId: 'github:acme/config'}),
      );

      const result = await sync(superseded, [shippyPath]);

      expect(result).toEqual({appliedCount: 0, deletedCount: 0, diagnostics: []});
      expect(await listProjectAgents(projectId)).toEqual(before);
      expect(before.map((entry) => entry.key)).toEqual(['reviewer']);
    });
  });

  describe('fetchAndApplyDefinitionWorkflows', () => {
    it('upserts workflow definitions and soft-deletes orphans', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);
      const workspaceId = crypto.randomUUID();

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId,
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      expect(result.appliedCount).toBe(1);
      expect(result.deletedCount).toBe(0);
      expect(result.diagnostics).toEqual([]);
      expect(getValidationCatalogV2).toHaveBeenLastCalledWith({workspaceId});
    });

    it('changes nothing when the project points at another source', async () => {
      const workspaceId = crypto.randomUUID();
      const current = createDefinitionSyncActivities(sourceControl(), agent, projects);
      await current.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId,
        sourceConnectionId,
        sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        sourceRef: 'main',
        paths: ['.shipfox/workflows/ci.yml'],
      });
      const before = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.projectId} = ${projectId}`);
      const outboxBefore = await db().select().from(definitionsOutbox);
      const source = sourceControl({
        listFiles: vi.fn(() => Promise.resolve({files: [], nextCursor: null})),
      });
      const superseded = createDefinitionSyncActivities(
        source,
        agent,
        projectsClient({
          sourceConnectionId,
          sourceExternalRepositoryId: 'github:acme/config',
        }),
      );

      const result = await superseded.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId,
        sourceConnectionId,
        sourceExternalRepositoryId: SOURCE_REPOSITORY_ID,
        sourceRef: 'main',
        paths: [],
      });

      expect(result).toEqual({appliedCount: 0, deletedCount: 0, diagnostics: []});
      const after = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.projectId} = ${projectId}`);
      expect(after).toEqual(before);
      expect(await db().select().from(definitionsOutbox)).toHaveLength(outboxBefore.length);
    });

    it('stores action snapshots and re-applies a definition when only action code changes', async () => {
      const workflowPath = '.shipfox/workflows/ci.yml';
      const repository: Record<string, string> = {
        [workflowPath]: [
          'name: Actions',
          'runner: ubuntu-latest',
          'jobs:',
          '  build:',
          '    steps:',
          '      - uses: ./.shipfox/actions/notify',
        ].join('\n'),
        '.shipfox/actions/notify/action.yml': 'name: Notify\nmain: index.ts\n',
        '.shipfox/actions/notify/index.ts': 'export default 1;\n',
      };
      const source = sourceControl({
        listFiles: vi.fn(({prefix}: {prefix: string}) =>
          Promise.resolve({
            files: Object.keys(repository)
              .filter((path) => path.startsWith(prefix))
              .map((path) => ({path, type: 'file' as const, size: repository[path]?.length ?? 0})),
            nextCursor: null,
          }),
        ),
        fetchFile: vi.fn(({path, ref}: {path: string; ref: string}) =>
          Promise.resolve({path, ref, content: repository[path] ?? ''}),
        ),
      });
      const activities = createDefinitionSyncActivities(source, agent, projects, undefined, {
        workflowPath: '.shipfox/workflows/',
        flags: createTestFeatureFlags({'definitions-actions': true}),
      });
      const workspaceId = crypto.randomUUID();
      const sync = () =>
        activities.fetchAndApplyDefinitionWorkflows({
          projectId,
          workspaceId,
          sourceConnectionId,
          sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
          sourceRef: 'main',
          paths: [workflowPath],
        });
      const storedDigest = async () => {
        const [row] = await db()
          .select({definition: workflowDefinitions.definition})
          .from(workflowDefinitions)
          .where(sql`${workflowDefinitions.projectId} = ${projectId}`);
        const step = row?.definition.model.jobs[0]?.steps[0];
        return step?.kind === 'action' ? step.action.digest : undefined;
      };
      const resolvedEventCount = async () => {
        const rows = await db()
          .select({id: definitionsOutbox.id})
          .from(definitionsOutbox)
          .where(
            sql`${definitionsOutbox.payload}->>'projectId' = ${projectId} and ${definitionsOutbox.eventType} = ${DEFINITION_RESOLVED}`,
          );
        return rows.length;
      };

      const first = await sync();
      const firstDigest = await storedDigest();
      const unchanged = await sync();
      repository['.shipfox/actions/notify/index.ts'] = 'export default 2;\n';
      const changed = await sync();
      const changedDigest = await storedDigest();

      expect(first.appliedCount).toBe(1);
      expect(unchanged.appliedCount).toBe(0);
      expect(changed.appliedCount).toBe(1);
      expect(await resolvedEventCount()).toBe(2);
      expect(changedDigest).not.toBe(firstDigest);
      for (const digest of [firstDigest, changedDigest]) {
        expect(await getActionSnapshot({workspaceId, digest: digest ?? ''})).toMatchObject({
          projectId,
          source: 'vcs',
          manifest: {name: 'Notify', main: 'index.ts'},
        });
      }
    });

    it('rejects an action step as a permanent failure while the definitions-actions flag is off', async () => {
      const source = sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/ci.yml',
            ref: 'main',
            content: [
              'name: Actions',
              'runner: ubuntu-latest',
              'jobs:',
              '  build:',
              '    steps:',
              '      - uses: ./.shipfox/actions/notify',
            ].join('\n'),
          }),
        ),
      });
      const activities = createDefinitionSyncActivities(source, agent, projects, undefined, {
        workflowPath: '.shipfox/workflows/',
        flags: createTestFeatureFlags(),
      });

      const error = await activities
        .fetchAndApplyDefinitionWorkflows({
          projectId,
          workspaceId: crypto.randomUUID(),
          sourceConnectionId,
          sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
          sourceRef: 'main',
          paths: ['.shipfox/workflows/ci.yml'],
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect(error).toMatchObject({nonRetryable: true, type: 'invalid-definition'});
    });

    it('adds the workflow file path to persisted diagnostics', async () => {
      const source = sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/warning.yml',
            ref: 'main',
            content: warningYaml,
          }),
        ),
      });
      const activities = createDefinitionSyncActivities(source, agent, projects);

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        paths: ['.shipfox/workflows/warning.yml'],
      });

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code: 're-evaluating-command',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
        filePath: '.shipfox/workflows/warning.yml',
      });
    });

    it('bounds diagnostics before returning the activity result', async () => {
      const paths = Array.from(
        {length: DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT + 1},
        (_, index) => `.shipfox/workflows/warning-${index}.yml`,
      );
      const source = sourceControl({
        fetchFile: vi.fn(({path}) => Promise.resolve({path, ref: 'main', content: warningYaml})),
      });
      const activities = createDefinitionSyncActivities(source, agent, projects);

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        paths,
      });

      expect(result.diagnostics).toHaveLength(DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT);
    });

    it('translates DefinitionSyncPermanentError into a non-retryable ApplicationFailure', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          fetchFile: vi.fn(() =>
            Promise.resolve({
              path: '.shipfox/workflows/bad.yml',
              ref: 'main',
              content: 'name: Bad\n  broken:\nindent',
            }),
          ),
        }),
        agent,
        projects,
      );

      const result = activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        sourceCommitSha: 'abc123',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(result).rejects.toMatchObject({nonRetryable: true, type: 'invalid-definition'});
    });

    it('carries validation diagnostics on invalid-definition ApplicationFailures', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          fetchFile: vi.fn(() =>
            Promise.resolve({
              path: '.shipfox/workflows/invalid.yml',
              ref: 'main',
              content: invalidPredicateYaml,
            }),
          ),
        }),
        agent,
        projects,
      );

      const result = activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        paths: ['.shipfox/workflows/invalid.yml'],
      });
      const error = await result.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect(error).toMatchObject({
        nonRetryable: true,
        type: 'invalid-definition',
        details: [
          [
            expect.objectContaining({
              code: 'invalid-definition',
              path: 'jobs.build.success',
              severity: 'error',
              filePath: '.shipfox/workflows/invalid.yml',
              message: expect.stringContaining('must return bool'),
            }),
          ],
        ],
      });
    });

    it('fetches from source commit sha while persisting under source ref', async () => {
      const source = sourceControl();
      const activities = createDefinitionSyncActivities(source, agent, projects);

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        sourceCommitSha: 'abc123',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      const rows = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.projectId} = ${projectId}`);
      expect(result.appliedCount).toBe(1);
      expect(source.fetchFile).toHaveBeenCalledWith(
        expect.objectContaining({ref: 'abc123', path: '.shipfox/workflows/ci.yml'}),
      );
      expect(rows[0]?.ref).toBe('main');
    });
  });

  describe('markDefinitionSyncFailed', () => {
    it('persists last_error_code and last_error_message verbatim', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);
      await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      const result = activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        code: 'invalid-definition',
        message: 'Invalid workflow at .shipfox/workflows/bad.yml',
      });
      await result;

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.lastErrorCode).toBe('invalid-definition');
      expect(rows[0]?.lastErrorMessage).toBe('Invalid workflow at .shipfox/workflows/bad.yml');
      expect(rows[0]?.warnings).toEqual([]);
      expect(rows[0]?.finishedAt).not.toBeNull();
    });

    it('persists validation diagnostics with a failed sync state', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);
      const diagnostics = [
        {
          code: 'invalid-definition',
          message: 'Step gate success must be a valid CEL boolean expression: No such key',
          path: 'jobs.build.steps.0.gate.success',
          filePath: '.shipfox/workflows/invalid.yml',
          severity: 'error' as const,
        },
      ];

      await activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        code: 'invalid-definition',
        message: 'Invalid workflow definition',
        diagnostics,
      });

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.warnings).toEqual(diagnostics);
    });

    it('persists failures with the unresolved sentinel ref when no ref was produced', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);

      const result = activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: null,
        code: 'connection-unavailable',
        message: 'connection disabled before resolving repository',
      });
      await result;

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ref).toBe('__unresolved__');
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.lastErrorCode).toBe('connection-unavailable');
      expect(rows[0]?.lastErrorMessage).toBe('connection disabled before resolving repository');
    });
  });

  describe('markDefinitionSyncSucceeded', () => {
    it('clears stale error fields when transitioning to succeeded', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent, projects);
      await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });
      await activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        code: 'invalid-definition',
        message: 'something',
      });

      const result = activities.markDefinitionSyncSucceeded({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        diagnostics: [
          {
            code: 're-evaluating-command',
            message: 'Workflow data is re-executed as shell code.',
            path: 'jobs.build.steps.0.run',
            severity: 'warning',
          },
        ],
      });
      await result;

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('succeeded');
      expect(rows[0]?.lastErrorCode).toBeNull();
      expect(rows[0]?.lastErrorMessage).toBeNull();
      expect(rows[0]?.warnings).toEqual([
        {
          code: 're-evaluating-command',
          message: 'Workflow data is re-executed as shell code.',
          path: 'jobs.build.steps.0.run',
          severity: 'warning',
        },
      ]);
    });
  });
});
