import {
  IntegrationProviderError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import type {WorkflowSpec} from './entities/definition.js';
import {DefinitionSyncPermanentError} from './errors.js';
import {type SyncDefinitionUpsert, syncDefinitionsFromSource} from './sync-definitions.js';

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
          externalRepositoryId: 'platform',
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

function syncParams(overrides: Partial<{sourceControl: IntegrationSourceControlService}> = {}) {
  const upserts: SyncDefinitionUpsert[] = [];
  const states: string[] = [];
  return {
    upserts,
    states,
    params: {
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      sourceConnectionId: 'connection-1',
      sourceExternalRepositoryId: 'platform',
      sourceControl: overrides.sourceControl ?? sourceControl(),
      markSyncing: vi.fn(() => {
        states.push('syncing');
        return Promise.resolve();
      }),
      markSucceeded: vi.fn(() => {
        states.push('succeeded');
        return Promise.resolve();
      }),
      markFailed: vi.fn(() => {
        states.push('failed');
        return Promise.resolve();
      }),
      upsertDefinition: vi.fn((input: SyncDefinitionUpsert) => {
        upserts.push(input);
        return Promise.resolve({} as WorkflowSpec);
      }),
    },
  };
}

describe('syncDefinitionsFromSource', () => {
  it('fetches workflow YAML and upserts VCS definitions', async () => {
    const {params, upserts, states} = syncParams();

    const result = await syncDefinitionsFromSource(params);

    expect(result).toEqual({ref: 'main', syncedDefinitions: 1});
    expect(states).toEqual(['syncing', 'succeeded']);
    expect(upserts[0]).toMatchObject({
      projectId: 'project-1',
      configPath: '.shipfox/workflows/ci.yml',
      source: 'vcs',
      ref: 'main',
      name: 'CI',
    });
  });

  it('marks no workflow files as a permanent failed sync', async () => {
    const {params, states} = syncParams({
      sourceControl: sourceControl({
        listFiles: vi.fn(() => Promise.resolve({files: [], nextCursor: null})),
      }),
    });

    const result = syncDefinitionsFromSource(params);

    await expect(result).rejects.toBeInstanceOf(DefinitionSyncPermanentError);
    expect(states).toEqual(['syncing', 'failed']);
    expect(params.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({code: 'no-workflow-files'}),
    );
  });

  it('marks invalid YAML as a permanent failed sync', async () => {
    const {params} = syncParams({
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/bad.yml',
            ref: 'main',
            content: 'name: Bad\n  broken:\nindent',
          }),
        ),
      }),
    });

    const result = syncDefinitionsFromSource(params);

    await expect(result).rejects.toBeInstanceOf(DefinitionSyncPermanentError);
    expect(params.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({code: 'invalid-definition'}),
    );
  });

  it('leaves transient provider failures retryable', async () => {
    const {params, states} = syncParams({
      sourceControl: sourceControl({
        listFiles: vi.fn(() => {
          throw new IntegrationProviderError('timeout', 'Provider timed out');
        }),
      }),
    });

    const result = syncDefinitionsFromSource(params);

    await expect(result).rejects.toMatchObject({reason: 'timeout'});
    expect(states).toEqual(['syncing']);
    expect(params.markFailed).not.toHaveBeenCalled();
  });
});
