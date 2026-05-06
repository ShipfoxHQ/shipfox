import {
  IntegrationProviderError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import {DefinitionSyncPermanentError} from './errors.js';
import {
  classifySyncFailure,
  discoverWorkflowFiles,
  fetchAndParseWorkflows,
  resolveSyncSource,
} from './sync-definitions.js';

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

const baseContext = {
  workspaceId: 'workspace-1',
  sourceConnectionId: 'connection-1',
  sourceExternalRepositoryId: 'debug:platform',
};

describe('resolveSyncSource', () => {
  it('returns the repository default branch as ref', async () => {
    const result = await resolveSyncSource({...baseContext, sourceControl: sourceControl()});

    expect(result).toEqual({ref: 'main'});
  });
});

describe('discoverWorkflowFiles', () => {
  it('returns yaml/yml workflow paths', async () => {
    const result = await discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      sourceControl: sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [
              {path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 64},
              {path: '.shipfox/workflows/deploy.yaml', type: 'file' as const, size: 64},
              {path: '.shipfox/workflows/README.md', type: 'file' as const, size: 64},
            ],
            nextCursor: null,
          }),
        ),
      }),
    });

    expect(result.paths).toEqual(['.shipfox/workflows/ci.yml', '.shipfox/workflows/deploy.yaml']);
  });

  it('throws no-workflow-files when nothing matches the yaml extensions', async () => {
    const result = discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      sourceControl: sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [{path: '.shipfox/workflows/README.md', type: 'file' as const, size: 1}],
            nextCursor: null,
          }),
        ),
      }),
    });

    await expect(result).rejects.toMatchObject({code: 'no-workflow-files'});
  });

  it('throws too-many-files when the listing reports more pages', async () => {
    const result = discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      sourceControl: sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 1}],
            nextCursor: '1',
          }),
        ),
      }),
    });

    await expect(result).rejects.toMatchObject({code: 'too-many-files'});
  });
});

describe('fetchAndParseWorkflows', () => {
  it('fetches and parses each provided path', async () => {
    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('CI');
    expect(result[0]?.path).toBe('.shipfox/workflows/ci.yml');
  });

  it('rejects oversized contents as content-too-large', async () => {
    const huge = 'x'.repeat(1_000_001);
    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/big.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({path: '.shipfox/workflows/big.yml', ref: 'main', content: huge}),
        ),
      }),
    });

    await expect(result).rejects.toBeInstanceOf(DefinitionSyncPermanentError);
    await expect(result).rejects.toMatchObject({code: 'content-too-large'});
  });

  it('rejects invalid YAML as invalid-definition', async () => {
    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/bad.yml'],
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

    await expect(result).rejects.toMatchObject({code: 'invalid-definition'});
  });

  it('emits onProgress for every path', async () => {
    const onProgress = vi.fn();
    await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl(),
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith('.shipfox/workflows/ci.yml');
  });
});

describe('classifySyncFailure', () => {
  it.each([
    ['rate-limited', true, 'provider-rate-limited'],
    ['timeout', true, 'provider-timeout'],
    ['provider-unavailable', true, 'provider-unavailable'],
    ['access-denied', false, 'provider-access-denied'],
    ['repository-not-found', false, 'provider-repository-not-found'],
    ['file-not-found', false, 'provider-file-not-found'],
    ['malformed-provider-response', false, 'provider-malformed-response'],
    ['content-too-large', false, 'content-too-large'],
    ['too-many-files', false, 'too-many-files'],
  ])('maps IntegrationProviderError(%s) to retryable=%s code=%s', (reason, retryable, code) => {
    const result = classifySyncFailure(
      // biome-ignore lint/suspicious/noExplicitAny: enumerated reason
      new IntegrationProviderError(reason as any, 'boom'),
    );

    expect(result).toEqual({code, message: 'boom', retryable});
  });

  it('classifies DefinitionSyncPermanentError as non-retryable', () => {
    const result = classifySyncFailure(
      new DefinitionSyncPermanentError('invalid-definition', 'bad yaml'),
    );

    expect(result).toEqual({code: 'invalid-definition', message: 'bad yaml', retryable: false});
  });

  it('falls back to unknown + retryable for plain errors', () => {
    const result = classifySyncFailure(new Error('boom'));

    expect(result).toEqual({code: 'unknown', message: 'boom', retryable: true});
  });
});
