import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {Context} from '@temporalio/activity';
import {ApplicationFailure} from '@temporalio/common';
import type {DefinitionSyncErrorCode} from '#core/entities/sync-state.js';
import {
  classifySyncFailure,
  DefinitionSyncPermanentError,
  discoverWorkflowFiles,
  fetchAndParseWorkflows,
  resolveSyncSource,
  UNRESOLVED_SYNC_REF,
} from '#core/index.js';
import {applyVcsDefinitionsBatch, markDefinitionSyncState} from '#db/index.js';

export interface SyncWorkflowInput {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

export interface SyncRefScopedInput extends SyncWorkflowInput {
  ref: string;
}

export interface FetchAndApplyActivityInput extends SyncRefScopedInput {
  paths: string[];
}

export interface MarkSyncFailedActivityInput extends SyncWorkflowInput {
  ref: string | null;
  code: DefinitionSyncErrorCode;
  message: string;
}

export interface PrepareSyncResult {
  ref: string;
}

export interface DiscoverWorkflowsActivityResult {
  paths: string[];
}

export interface FetchAndApplyActivityResult {
  appliedCount: number;
  deletedCount: number;
}

export function createDefinitionSyncActivities(sourceControl: IntegrationSourceControlService) {
  return {
    prepareDefinitionSync: createPrepareDefinitionSyncActivity(sourceControl),
    discoverDefinitionWorkflows: createDiscoverDefinitionWorkflowsActivity(sourceControl),
    fetchAndApplyDefinitionWorkflows: createFetchAndApplyActivity(sourceControl),
    markDefinitionSyncSucceeded: createMarkSyncSucceededActivity(),
    markDefinitionSyncFailed: createMarkSyncFailedActivity(),
  };
}

function createPrepareDefinitionSyncActivity(sourceControl: IntegrationSourceControlService) {
  return async function prepareDefinitionSync(
    input: SyncWorkflowInput,
  ): Promise<PrepareSyncResult> {
    return await runWithPermanentTranslation(async () => {
      const {ref} = await resolveSyncSource({...input, sourceControl});

      await markDefinitionSyncState({
        projectId: input.projectId,
        sourceConnectionId: input.sourceConnectionId,
        sourceExternalRepositoryId: input.sourceExternalRepositoryId,
        ref,
        status: 'syncing',
        lastErrorCode: null,
        lastErrorMessage: null,
        startedAt: new Date(),
        finishedAt: null,
      });

      return {ref};
    });
  };
}

function createDiscoverDefinitionWorkflowsActivity(sourceControl: IntegrationSourceControlService) {
  return async function discoverDefinitionWorkflows(
    input: SyncRefScopedInput,
  ): Promise<DiscoverWorkflowsActivityResult> {
    return await runWithPermanentTranslation(async () => {
      return await discoverWorkflowFiles({...input, sourceControl});
    });
  };
}

function createFetchAndApplyActivity(sourceControl: IntegrationSourceControlService) {
  return async function fetchAndApplyDefinitionWorkflows(
    input: FetchAndApplyActivityInput,
  ): Promise<FetchAndApplyActivityResult> {
    return await runWithPermanentTranslation(async () => {
      const definitions = await fetchAndParseWorkflows({
        ...input,
        sourceControl,
        onProgress: (path) => Context.current().heartbeat({path}),
      });

      return await applyVcsDefinitionsBatch({
        projectId: input.projectId,
        ref: input.ref,
        upserts: definitions.map((entry) => ({
          configPath: entry.path,
          name: entry.name,
          definition: entry.definition,
          contentHash: entry.contentHash,
        })),
      });
    });
  };
}

function createMarkSyncSucceededActivity() {
  return async function markDefinitionSyncSucceeded(input: SyncRefScopedInput): Promise<void> {
    await markDefinitionSyncState({
      projectId: input.projectId,
      sourceConnectionId: input.sourceConnectionId,
      sourceExternalRepositoryId: input.sourceExternalRepositoryId,
      ref: input.ref,
      status: 'succeeded',
      lastErrorCode: null,
      lastErrorMessage: null,
      finishedAt: new Date(),
    });
  };
}

function createMarkSyncFailedActivity() {
  return async function markDefinitionSyncFailed(
    input: MarkSyncFailedActivityInput,
  ): Promise<void> {
    await markDefinitionSyncState({
      projectId: input.projectId,
      sourceConnectionId: input.sourceConnectionId,
      sourceExternalRepositoryId: input.sourceExternalRepositoryId,
      ref: input.ref ?? UNRESOLVED_SYNC_REF,
      status: 'failed',
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      finishedAt: new Date(),
    });
  };
}

async function runWithPermanentTranslation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DefinitionSyncPermanentError) {
      throw ApplicationFailure.nonRetryable(error.message, error.code);
    }
    if (error instanceof ApplicationFailure) {
      throw error;
    }
    const failure = classifySyncFailure(error);
    if (!failure.retryable) {
      throw ApplicationFailure.nonRetryable(failure.message, failure.code);
    }
    throw error;
  }
}
