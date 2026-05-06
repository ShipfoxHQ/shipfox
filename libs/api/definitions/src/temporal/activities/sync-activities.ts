import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {ApplicationFailure} from '@temporalio/common';
import {DefinitionSyncPermanentError, syncDefinitionsFromSource} from '#core/index.js';
import {markDefinitionSyncState, upsertDefinition} from '#db/index.js';

export interface SyncDefinitionsActivityInput {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

export function createSyncDefinitionsActivity(sourceControl: IntegrationSourceControlService) {
  return async function syncDefinitionsForProjectSource(
    input: SyncDefinitionsActivityInput,
  ): Promise<{ref: string; syncedDefinitions: number}> {
    try {
      return await syncDefinitionsFromSource({
        ...input,
        sourceControl,
        markSyncing: async (state) => {
          await markDefinitionSyncState({
            ...state,
            status: 'syncing',
            startedAt: new Date(),
            finishedAt: null,
          });
        },
        markSucceeded: async (state) => {
          await markDefinitionSyncState({
            ...state,
            status: 'succeeded',
            finishedAt: new Date(),
          });
        },
        markFailed: async (state) => {
          await markDefinitionSyncState({
            ...state,
            status: 'failed',
            finishedAt: new Date(),
          });
        },
        upsertDefinition,
      });
    } catch (error) {
      if (error instanceof DefinitionSyncPermanentError) {
        throw ApplicationFailure.nonRetryable(error.message, error.code);
      }
      throw error;
    }
  };
}
