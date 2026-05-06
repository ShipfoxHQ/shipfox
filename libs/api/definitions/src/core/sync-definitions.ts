import {
  IntegrationProviderError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import type {DefinitionSyncErrorCode} from './entities/sync-state.js';
import {DefinitionParseError, DefinitionSyncPermanentError} from './errors.js';
import {parseDefinition} from './parse-definition.js';

const WORKFLOW_PREFIX = '.shipfox/workflows/';
const MAX_WORKFLOW_FILES = 100;
const MAX_FILE_BYTES = 1_000_000;
const FILE_FETCH_CONCURRENCY = 4;

export interface SyncDefinitionsFromSourceParams {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceControl: IntegrationSourceControlService;
  markSyncing: (input: SyncStateUpdate) => Promise<void>;
  markSucceeded: (input: SyncStateUpdate) => Promise<void>;
  markFailed: (input: SyncFailureUpdate) => Promise<void>;
  upsertDefinition: (input: SyncDefinitionUpsert) => Promise<unknown>;
}

export interface SyncStateUpdate {
  projectId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  ref: string;
}

export interface SyncFailureUpdate extends SyncStateUpdate {
  code: DefinitionSyncErrorCode;
  message: string;
}

export interface SyncDefinitionUpsert {
  projectId: string;
  configPath: string;
  source: 'vcs';
  ref: string;
  name: string;
  definition: ReturnType<typeof parseDefinition>;
}

export interface SyncDefinitionsFromSourceResult {
  ref: string;
  syncedDefinitions: number;
}

export async function syncDefinitionsFromSource(
  params: SyncDefinitionsFromSourceParams,
): Promise<SyncDefinitionsFromSourceResult> {
  const source = await params.sourceControl.resolveRepository({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
  });
  const ref = source.repository.defaultBranch;
  const state = {
    projectId: params.projectId,
    sourceConnectionId: params.sourceConnectionId,
    sourceExternalRepositoryId: params.sourceExternalRepositoryId,
    ref,
  };

  await params.markSyncing(state);

  try {
    const files = await listWorkflowFiles(params, ref);
    const definitions = await mapWithConcurrency(files, FILE_FETCH_CONCURRENCY, async (file) => {
      const snapshot = await params.sourceControl.fetchFile({
        workspaceId: params.workspaceId,
        connectionId: params.sourceConnectionId,
        externalRepositoryId: params.sourceExternalRepositoryId,
        ref,
        path: file.path,
      });

      if (new TextEncoder().encode(snapshot.content).length > MAX_FILE_BYTES) {
        throw new DefinitionSyncPermanentError(
          'content-too-large',
          `Workflow file is larger than ${MAX_FILE_BYTES} bytes: ${file.path}`,
        );
      }

      try {
        const definition = parseDefinition(snapshot.content);
        return {path: snapshot.path, definition};
      } catch (error) {
        if (error instanceof DefinitionParseError) {
          throw new DefinitionSyncPermanentError(
            'invalid-definition',
            `Invalid workflow definition at ${snapshot.path}: ${error.message}`,
          );
        }
        throw error;
      }
    });

    for (const item of definitions) {
      await params.upsertDefinition({
        projectId: params.projectId,
        configPath: item.path,
        source: 'vcs',
        ref,
        name: item.definition.name,
        definition: item.definition,
      });
    }

    await params.markSucceeded(state);

    return {ref, syncedDefinitions: definitions.length};
  } catch (error) {
    const failure = toSyncFailure(error);
    if (!failure.retryable) {
      await params.markFailed({...state, code: failure.code, message: failure.message});
      throw new DefinitionSyncPermanentError(failure.code, failure.message);
    }
    throw error;
  }
}

async function listWorkflowFiles(
  params: SyncDefinitionsFromSourceParams,
  ref: string,
): Promise<Array<{path: string}>> {
  const page = await params.sourceControl.listFiles({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
    ref,
    prefix: WORKFLOW_PREFIX,
    limit: MAX_WORKFLOW_FILES,
  });
  if (page.nextCursor) {
    throw new DefinitionSyncPermanentError(
      'too-many-files',
      `More than ${MAX_WORKFLOW_FILES} workflow files were found`,
    );
  }

  const files = page.files.filter(
    (file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'),
  );
  if (files.length === 0) {
    throw new DefinitionSyncPermanentError(
      'no-workflow-files',
      `No workflow files were found under ${WORKFLOW_PREFIX}`,
    );
  }

  return files;
}

function toSyncFailure(error: unknown): {
  code: DefinitionSyncErrorCode;
  message: string;
  retryable: boolean;
} {
  if (error instanceof DefinitionSyncPermanentError) {
    return {code: error.code as DefinitionSyncErrorCode, message: error.message, retryable: false};
  }
  if (error instanceof IntegrationProviderError) {
    return {
      code: providerErrorCode(error.reason),
      message: error.message,
      retryable:
        error.reason === 'rate-limited' ||
        error.reason === 'timeout' ||
        error.reason === 'provider-unavailable',
    };
  }
  if (error instanceof Error && 'reason' in error && typeof error.reason === 'string') {
    const reason = error.reason;
    return {
      code: providerErrorCode(reason),
      message: error.message,
      retryable:
        reason === 'rate-limited' || reason === 'timeout' || reason === 'provider-unavailable',
    };
  }

  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function providerErrorCode(reason: string): DefinitionSyncErrorCode {
  if (reason === 'repository-not-found') return 'provider-repository-not-found';
  if (reason === 'file-not-found') return 'provider-file-not-found';
  if (reason === 'access-denied') return 'provider-access-denied';
  if (reason === 'rate-limited') return 'provider-rate-limited';
  if (reason === 'timeout') return 'provider-timeout';
  if (reason === 'provider-unavailable') return 'provider-unavailable';
  if (reason === 'malformed-provider-response') return 'provider-malformed-response';
  if (reason === 'content-too-large') return 'content-too-large';
  if (reason === 'too-many-files') return 'too-many-files';
  return 'unknown';
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index] as T);
    }
  }

  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, () => worker()));

  return results;
}
