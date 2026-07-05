import {createHash} from 'node:crypto';
import {
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  type IntegrationSourceControlService,
  MAX_REPOSITORY_FILE_BYTES,
} from '@shipfox/api-integration-core';
import {boundedMap} from '@shipfox/node-module';
import type {DefinitionSyncErrorCode} from './entities/sync-state.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {DefinitionParseError, DefinitionSyncPermanentError} from './errors.js';
import {parseDefinition} from './parse-definition.js';

export const WORKFLOW_PREFIX = '.shipfox/workflows/';
export const MAX_WORKFLOW_FILES = 100;
export const FILE_FETCH_CONCURRENCY = 4;
export const UNRESOLVED_SYNC_REF = '__unresolved__';

export interface SyncSourceContext {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceControl: IntegrationSourceControlService;
}

export interface ResolvedSyncSource {
  ref: string;
}

export async function resolveSyncSource(params: SyncSourceContext): Promise<ResolvedSyncSource> {
  const source = await params.sourceControl.resolveRepository({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
  });
  return {ref: source.repository.defaultBranch};
}

export interface DiscoverWorkflowFilesParams extends SyncSourceContext {
  ref: string;
}

export async function discoverWorkflowFiles(
  params: DiscoverWorkflowFilesParams,
): Promise<{paths: string[]}> {
  const page = await params.sourceControl.listFiles({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
    ref: params.ref,
    prefix: WORKFLOW_PREFIX,
    limit: MAX_WORKFLOW_FILES,
  });
  if (page.nextCursor) {
    throw new DefinitionSyncPermanentError(
      'too-many-files',
      `More than ${MAX_WORKFLOW_FILES} workflow files were found`,
    );
  }

  const paths = page.files
    .filter((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'))
    .map((file) => file.path);
  if (paths.length === 0) {
    throw new DefinitionSyncPermanentError(
      'no-workflow-files',
      `No workflow files were found under ${WORKFLOW_PREFIX}`,
    );
  }

  return {paths};
}

export interface ParsedWorkflow {
  path: string;
  name: string;
  definition: WorkflowDefinitionPayload;
  contentHash: string;
}

export interface FetchAndParseWorkflowsParams extends SyncSourceContext {
  ref: string;
  paths: string[];
  onProgress?: ((path: string) => void) | undefined;
}

export async function fetchAndParseWorkflows(
  params: FetchAndParseWorkflowsParams,
): Promise<ParsedWorkflow[]> {
  return await boundedMap(
    params.paths,
    FILE_FETCH_CONCURRENCY,
    async (path) => {
      params.onProgress?.(path);

      const snapshot = await params.sourceControl.fetchFile({
        workspaceId: params.workspaceId,
        connectionId: params.sourceConnectionId,
        externalRepositoryId: params.sourceExternalRepositoryId,
        ref: params.ref,
        path,
      });

      if (Buffer.byteLength(snapshot.content, 'utf8') > MAX_REPOSITORY_FILE_BYTES) {
        throw new DefinitionSyncPermanentError(
          'content-too-large',
          `Workflow file is larger than ${MAX_REPOSITORY_FILE_BYTES} bytes: ${snapshot.path}`,
        );
      }

      try {
        const definition = parseDefinition(snapshot.content);
        const contentHash = sha256Hex(snapshot.content);
        return {path: snapshot.path, name: definition.document.name, definition, contentHash};
      } catch (error) {
        if (error instanceof DefinitionParseError) {
          throw new DefinitionSyncPermanentError(
            'invalid-definition',
            `Invalid workflow definition at ${snapshot.path}: ${error.message}`,
          );
        }
        throw error;
      }
    },
    {stopOnError: true},
  );
}

export interface SyncFailureClassification {
  code: DefinitionSyncErrorCode;
  message: string;
  retryable: boolean;
}

export function classifySyncFailure(error: unknown): SyncFailureClassification {
  if (error instanceof DefinitionSyncPermanentError) {
    return {code: error.code, message: error.message, retryable: false};
  }
  if (
    error instanceof IntegrationConnectionNotFoundError ||
    error instanceof IntegrationConnectionInactiveError ||
    error instanceof IntegrationConnectionWorkspaceMismatchError
  ) {
    return {code: 'connection-unavailable', message: error.message, retryable: false};
  }
  if (error instanceof IntegrationProviderError) {
    return {
      code: providerErrorCode(error.reason),
      message: error.message,
      retryable: isProviderReasonRetryable(error.reason),
    };
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function isProviderReasonRetryable(reason: string): boolean {
  return reason === 'rate-limited' || reason === 'timeout' || reason === 'provider-unavailable';
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

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
