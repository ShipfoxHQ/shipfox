import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {ApplicationFailure} from '@temporalio/common';
import {sql} from 'drizzle-orm';
import {db, definitionSyncStates} from '#db/index.js';
import {createDefinitionSyncActivities} from './sync-activities.js';

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({heartbeat: vi.fn()}),
  },
  log: {
    info: vi.fn(),
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

      expect(result).toEqual({ref: 'main'});
      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('syncing');
      expect(rows[0]?.ref).toBe('main');
    });

    it('rethrows resolveRepository failures untranslated when retryable', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          resolveRepository: vi.fn(() => {
            return Promise.reject(
              Object.assign(new Error('temporary outage'), {reason: 'timeout'}),
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

      await expect(result).rejects.not.toBeInstanceOf(ApplicationFailure);
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
        ref: 'main',
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
        ref: 'main',
        paths: ['.shipfox/workflows/bad.yml'],
      });

      await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(result).rejects.toMatchObject({nonRetryable: true, type: 'invalid-definition'});
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

      await activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
        ref: 'main',
        code: 'invalid-definition',
        message: 'Invalid workflow at .shipfox/workflows/bad.yml',
      });

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.lastErrorCode).toBe('invalid-definition');
      expect(rows[0]?.lastErrorMessage).toBe('Invalid workflow at .shipfox/workflows/bad.yml');
      expect(rows[0]?.finishedAt).not.toBeNull();
    });

    it('skips writing when ref is unknown', async () => {
      const activities = createDefinitionSyncActivities(sourceControl());

      await activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
        ref: null,
        code: 'unknown',
        message: 'resolve failed before producing a ref',
      });

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows).toHaveLength(0);
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
        ref: 'main',
        code: 'invalid-definition',
        message: 'something',
      });

      await activities.markDefinitionSyncSucceeded({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'debug:platform',
        ref: 'main',
      });

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
