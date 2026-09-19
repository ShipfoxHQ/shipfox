import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {getRunnerSessionById} from '#db/runner-sessions.js';

type RunnerToolHarness = keyof RunnerToolCapabilitiesDto['harnesses'];

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
  if (!runnerSession) throw new Error(`Runner session not found: ${params.runnerSessionId}`);
  const capabilities = runnerSession.toolCapabilities;

  return {
    capabilities,
    harnessKnown: (harness) => capabilities.harnesses[harness] !== undefined,
  };
}
