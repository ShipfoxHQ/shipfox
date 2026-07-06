import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';

export const EMPTY_RUNNER_TOOL_CAPABILITIES: RunnerToolCapabilitiesDto = {
  harnesses: {},
};

export function effectiveRunnerToolCapabilities(params: {
  toolCapabilities: RunnerToolCapabilitiesDto | null;
  reportedAt: Date | null;
  staleAfterSeconds: number;
  now?: Date;
}): RunnerToolCapabilitiesDto {
  if (!params.toolCapabilities || !params.reportedAt) return EMPTY_RUNNER_TOOL_CAPABILITIES;

  const now = params.now ?? new Date();
  const ageMs = now.getTime() - params.reportedAt.getTime();
  if (ageMs > params.staleAfterSeconds * 1000) return EMPTY_RUNNER_TOOL_CAPABILITIES;

  return params.toolCapabilities;
}
