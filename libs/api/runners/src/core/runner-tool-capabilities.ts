import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {getRunnerSessionById} from '#db/runner-sessions.js';

type RunnerToolHarness = keyof RunnerToolCapabilitiesDto['harnesses'];

export const EMPTY_RUNNER_TOOL_CAPABILITIES: RunnerToolCapabilitiesDto = {
  harnesses: {},
};

export function unadvertisedRunnerTools(params: {
  harness: RunnerToolHarness;
  requestedTools: readonly string[];
  capabilities: RunnerToolCapabilitiesDto;
}): string[] {
  const advertised = new Set(params.capabilities.harnesses[params.harness]?.tools ?? []);
  return params.requestedTools.filter((tool) => !advertised.has(tool));
}

export interface EffectiveRunnerToolCapabilitiesResult {
  capabilities: RunnerToolCapabilitiesDto;
  harnessKnown(harness: RunnerToolHarness): boolean;
}

export async function getEffectiveRunnerToolCapabilities(params: {
  runnerSessionId: string;
}): Promise<EffectiveRunnerToolCapabilitiesResult> {
  const runnerSession = await getRunnerSessionById(params.runnerSessionId);
  const capabilities = runnerSession?.toolCapabilities ?? EMPTY_RUNNER_TOOL_CAPABILITIES;

  return {
    capabilities,
    harnessKnown: (harness) => capabilities.harnesses[harness] !== undefined,
  };
}
