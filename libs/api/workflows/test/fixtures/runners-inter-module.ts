import type {RunnerFeaturesDto, RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';

const activeLeases = new Set<string>();
const leaseStates = new Map<
  string,
  Awaited<ReturnType<RunnersInterModuleClient['getLeaseState']>>
>();
const toolCapabilities = new Map<
  string,
  Awaited<ReturnType<RunnersInterModuleClient['getEffectiveRunnerToolCapabilities']>>
>();

type TestRunnerToolCapabilities = Omit<RunnerToolCapabilitiesDto, 'features'> & {
  features?: Partial<RunnerFeaturesDto>;
};

function leaseKey(params: {
  jobId: string;
  jobExecutionId: string;
  runnerSessionId: string;
}): string {
  return `${params.jobId}:${params.jobExecutionId}:${params.runnerSessionId}`;
}

export function registerActiveRunnerLease(params: {
  jobId: string;
  jobExecutionId: string;
  runnerSessionId: string;
  renewableInference: boolean;
}): void {
  const key = leaseKey(params);
  activeLeases.add(key);
  leaseStates.set(key, {
    active: true,
    renewableInference: params.renewableInference,
  });
}

export function setRunnerToolCapabilities(
  runnerSessionId: string,
  capabilities: {capabilities: TestRunnerToolCapabilities},
): void {
  toolCapabilities.set(runnerSessionId, {
    capabilities: {
      features: {
        renewable_git: capabilities.capabilities.features?.renewable_git ?? false,
        renewable_inference: capabilities.capabilities.features?.renewable_inference ?? false,
      },
      harnesses: capabilities.capabilities.harnesses,
    },
  });
}

export function resetRunnersTestClient(): void {
  activeLeases.clear();
  leaseStates.clear();
  toolCapabilities.clear();
}

export const runnersTestClient: RunnersInterModuleClient = {
  getLeaseState: async (params) =>
    leaseStates.get(leaseKey(params)) ?? {
      active: activeLeases.has(leaseKey(params)),
      renewableInference: false,
    },
  getEffectiveRunnerToolCapabilities: async ({runnerSessionId}) =>
    toolCapabilities.get(runnerSessionId) ?? {
      capabilities: {
        features: {renewable_git: false, renewable_inference: false},
        harnesses: {},
      },
    },
  getWorkspaceJobCounts: async ({workspaceIds}) => ({
    counts: workspaceIds.map((workspaceId) => ({workspaceId, queued: 0, running: 0})),
  }),
};
