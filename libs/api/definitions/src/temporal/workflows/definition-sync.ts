import {proxyActivities} from '@temporalio/workflow';
import type {createDefinitionSyncActivities} from '../activities/index.js';

export interface DefinitionSyncWorkflowInput {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

const {syncDefinitionsForProjectSource} = proxyActivities<
  ReturnType<typeof createDefinitionSyncActivities>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 5,
  },
});

export async function definitionSyncWorkflow(
  input: DefinitionSyncWorkflowInput,
): Promise<{ref: string; syncedDefinitions: number}> {
  return await syncDefinitionsForProjectSource(input);
}
