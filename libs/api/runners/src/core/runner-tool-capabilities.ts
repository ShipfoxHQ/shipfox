import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {config} from '#config.js';
import {getRunnerSessionById} from '#db/runner-sessions.js';

type RunnerToolHarness = keyof RunnerToolCapabilitiesDto['harnesses'];

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

function runnerToolCapabilityReportIsFresh(params: {
  toolCapabilities: RunnerToolCapabilitiesDto | null | undefined;
  reportedAt: Date | null | undefined;
  staleAfterSeconds: number;
  now?: Date;
}): boolean {
  if (!params.toolCapabilities || !params.reportedAt) return false;

  const now = params.now ?? new Date();
  const ageMs = now.getTime() - params.reportedAt.getTime();
  return ageMs <= params.staleAfterSeconds * 1000;
}

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
  reportFresh: boolean;
  harnessKnown(harness: RunnerToolHarness): boolean;
}

export async function getEffectiveRunnerToolCapabilities(params: {
  runnerSessionId: string;
}): Promise<EffectiveRunnerToolCapabilitiesResult> {
  const runnerSession = await getRunnerSessionById(params.runnerSessionId);
  const staleAfterSeconds = config.RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS;
  const capabilities = effectiveRunnerToolCapabilities({
    toolCapabilities: runnerSession?.toolCapabilities ?? null,
    reportedAt: runnerSession?.toolCapabilitiesReportedAt ?? null,
    staleAfterSeconds,
  });
  const reportFresh = runnerToolCapabilityReportIsFresh({
    toolCapabilities: runnerSession?.toolCapabilities,
    reportedAt: runnerSession?.toolCapabilitiesReportedAt,
    staleAfterSeconds,
  });

  return {
    capabilities,
    reportFresh,
    harnessKnown: (harness) => capabilities.harnesses[harness] !== undefined,
  };
}
