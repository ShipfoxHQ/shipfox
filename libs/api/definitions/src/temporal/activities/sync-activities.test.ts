import {
  IntegrationProviderError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import {ApplicationFailure} from '@temporalio/common';
import {sql} from 'drizzle-orm';
import {db, definitionSyncStates} from '#db/index.js';
import {workflowDefinitions} from '#db/schema/definitions.js';
import {createDefinitionSyncActivities} from './sync-activities.js';

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({heartbeat: vi.fn()}),
  },
}));

const validYaml = `
name: CI
jobs:
  build:
    steps:
      - run: pnpm test
`;

function sourceControl(
  overrides: Partial<IntegrationSourceControlService> = {},
): IntegrationSourceControlService {
  return {
    getConnection: vi.fn(),
    listRepositories: vi.fn(),
    resolveRepository: vi.fn(() =>
      Promise.resolve({
        connection: {
          id: 'connection-1',
          workspaceId: 'workspace-1',
          provider: 'debug',
          externalAccountId: 'debug',
          displayName: 'Debug',
          lifecycleStatus: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        repository: {
          externalRepositoryId: 'debug:platform',
          owner: 'debug-owner',
          name: 'platform',
          fullName: 'debug-owner/platform',
          defaultBranch: 'main',
          visibility: 'private' as const,
          cloneUrl: 'https://debug.local/debug-owner/platform.git',
          htmlUrl: 'https://debug.local/debug-owner/platform',
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
    createCheckoutSpec: vi.fn(),
    ...overrides,
  };
}

describe('definition sync activities', () => {
  let projectId: string;
  let sourceConnectionId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
  });

  describe('prepareDefinitionSync', () => {
    it('marks the sync state as syncing and returns the resolved ref', async () => {
      const activities = createDefinitionSyncActivities(sourceControl());

      const result = await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
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
      const activities = createDefinitionSyncActivities(source);

      const result = await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
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
      );

      const result = activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
      });

      await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(result).rejects.toMatchObject({
        nonRetryable: false,
        type: 'unknown',
        message: 'temporary outage',
      });
    });

    it('preserves retryable provider error codes for workflow-level failure persistence', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          resolveRepository: vi.fn(() => {
            return Promise.reject(
              new IntegrationProviderError('timeout', 'GitHub request timed out'),
            );
          }),
        }),
      );

      const result = activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
      });

      await expect(result).rejects.toMatchObject({
        nonRetryable: false,
        type: 'provider-timeout',
        message: 'GitHub request timed out',
      });
    });
  });

  describe('fetchAndApplyDefinitionWorkflows', () => {
    it('upserts workflow definitions and soft-deletes orphans', async () => {
      const activities = createDefinitionSyncActivities(sourceControl());

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
        sourceRef: 'main',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      expect(result.appliedCount).toBe(1);
      expect(result.deletedCount).toBe(0);
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
      );

      const result = activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
        sourceRef: 'main',
        sourceCommitSha: 'abc123',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(result).rejects.toMatchObject({nonRetryable: true, type: 'invalid-definition'});
    });

    it('fetches from source commit sha while persisting under source ref', async () => {
      const source = sourceControl();
      const activities = createDefinitionSyncActivities(source);

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
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
      const activities = createDefinitionSyncActivities(sourceControl());
      await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
      });

      const result = activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
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
      expect(rows[0]?.finishedAt).not.toBeNull();
    });

    it('persists failures with the unresolved sentinel ref when no ref was produced', async () => {
      const activities = createDefinitionSyncActivities(sourceControl());

      const result = activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
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
      const activities = createDefinitionSyncActivities(sourceControl());
      await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
      });
      await activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
        sourceRef: 'main',
        code: 'invalid-definition',
        message: 'something',
      });

      const result = activities.markDefinitionSyncSucceeded({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
        sourceRef: 'main',
      });
      await result;

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('succeeded');
      expect(rows[0]?.lastErrorCode).toBeNull();
      expect(rows[0]?.lastErrorMessage).toBeNull();
    });
  });
});
