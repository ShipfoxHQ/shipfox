import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {defineInterModulePresentation, type InterModulePresentation} from '@shipfox/inter-module';
import {getEffectiveRunnerToolCapabilities} from '#core/runner-tool-capabilities.js';
import {getWorkspaceCapacityUsage} from '#db/capacity-holds.js';
import {
  expirePendingJobExecution,
  getJobLeaseState,
  getPendingJobExecutionWait,
  getWorkspaceJobCounts,
} from '#db/job-executions.js';

export function createRunnersInterModulePresentation(): InterModulePresentation<
  typeof runnersInterModuleContract
> {
  return defineInterModulePresentation(runnersInterModuleContract, {
    getLeaseState: getJobLeaseState,
    getEffectiveRunnerToolCapabilities: async (input) => {
      const result = await getEffectiveRunnerToolCapabilities(input);
      return {capabilities: result.capabilities};
    },
    getWorkspaceJobCounts: async ({workspaceIds}) => ({
      counts: await getWorkspaceJobCounts({workspaceIds}),
    }),
    getPendingJobExecutionWait,
    expirePendingJobExecution: async ({jobExecutionId}) => {
      const result = await expirePendingJobExecution({jobExecutionId});
      return result.kind === 'claimed'
        ? {...result, claimedAt: result.claimedAt.toISOString()}
        : result;
    },
    getWorkspaceCapacityUsage: async ({workspaceIds}) => ({
      usage: await getWorkspaceCapacityUsage({workspaceIds}),
    }),
  });
}
