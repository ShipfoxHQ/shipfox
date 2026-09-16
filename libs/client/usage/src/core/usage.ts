export type UsageJobExecutionState = 'queued' | 'running' | 'terminated';
export type UsageJobExecutionStatus = 'succeeded' | 'failed' | 'cancelled';
export type UsageInferenceDialect =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses';

export interface UsageTokenClasses {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
}

export interface UsageJobExecution {
  jobId: string;
  jobExecutionId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  workspaceId: string;
  projectId: string;
  definitionId: string | null;
  jobKey: string | null;
  runNumber: number | null;
  requestedLabels: string[] | null;
  runnerLabels: string[] | null;
  templateKey: string | null;
  provisionerId: string | null;
  provisionerScope: string | null;
  providerKind: string | null;
  launchKind: string | null;
  runnerClass: string | null;
  runnerArch: string | null;
  runnerCpu: string | null;
  managed: boolean | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  leaseExpiredAt: string | null;
  status: UsageJobExecutionStatus | null;
  statusReason: string | null;
  cancellationReason: string | null;
  durationSeconds: number | null;
  state: UsageJobExecutionState | null;
  recordedAt: string | null;
}

export interface UsageInferenceSegment {
  id: string;
  segmentKey: string;
  source: 'gateway';
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
  model: string;
  dialect: UsageInferenceDialect;
  windowStart: string;
  windowEnd: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  webSearchRequests: number;
  tokenClasses: UsageTokenClasses;
  recordedAt: string;
}

export interface RunUsage {
  jobExecutions: UsageJobExecution[];
  inferenceSegments: UsageInferenceSegment[];
}

export interface JobExecutionUsage {
  jobExecution: UsageJobExecution;
  inferenceSegments: UsageInferenceSegment[];
}

export interface UsageTokenTotals extends UsageTokenClasses {
  requestCount: number;
  /** Raw reasoning tokens are included in outputTokens and retained for detail views. */
  reasoningTokens: number;
  webSearchRequests: number;
}

export interface UsageModelTotals extends UsageTokenTotals {
  model: string;
}

export interface UsageRunSummary {
  computeSeconds: number;
  totals: UsageTokenTotals;
  byModel: UsageModelTotals[];
}

export function emptyUsageTokenTotals(): UsageTokenTotals {
  return {
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitRate: 0,
    reasoningTokens: 0,
    webSearchRequests: 0,
  };
}

export function usageTokenTotalsForSegments(
  segments: readonly UsageInferenceSegment[],
): UsageTokenTotals {
  return segments.reduce(
    (totals, segment) => addUsageTokenTotals(totals, segment),
    emptyUsageTokenTotals(),
  );
}

export function usageQuantitiesFromTotals(totals: UsageTokenTotals, computeSeconds = 0) {
  return {
    computeSeconds,
    requestCount: totals.requestCount,
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    outputTokens: totals.outputTokens,
    webSearchRequests: totals.webSearchRequests,
  };
}

export function summarizeRunUsage(usage: RunUsage): UsageRunSummary {
  const byModel = new Map<string, UsageTokenTotals>();
  for (const segment of usage.inferenceSegments) {
    const totals = byModel.get(segment.model) ?? emptyUsageTokenTotals();
    byModel.set(segment.model, addUsageTokenTotals(totals, segment));
  }

  return {
    computeSeconds: usage.jobExecutions.reduce(
      (total, execution) => total + (execution.durationSeconds ?? 0),
      0,
    ),
    totals: usageTokenTotalsForSegments(usage.inferenceSegments),
    byModel: [...byModel.entries()]
      .sort(
        ([leftModel, leftTotals], [rightModel, rightTotals]) =>
          rightTotals.totalTokens - leftTotals.totalTokens || leftModel.localeCompare(rightModel),
      )
      .map(([model, totals]) => ({model, ...totals})),
  };
}

export function groupUsageByModel(segments: readonly UsageInferenceSegment[]) {
  const grouped = new Map<string, {model: string; totals: UsageTokenTotals}>();
  for (const segment of segments) {
    const current = grouped.get(segment.model);
    grouped.set(segment.model, {
      model: segment.model,
      totals: addUsageTokenTotals(current?.totals ?? emptyUsageTokenTotals(), segment),
    });
  }
  return [...grouped.values()].sort(
    (left, right) =>
      right.totals.totalTokens - left.totals.totalTokens || left.model.localeCompare(right.model),
  );
}

function addUsageTokenTotals(
  totals: UsageTokenTotals,
  segment: Pick<
    UsageInferenceSegment,
    'requestCount' | 'reasoningTokens' | 'webSearchRequests' | 'tokenClasses'
  >,
): UsageTokenTotals {
  const {tokenClasses} = segment;
  const next = {
    requestCount: totals.requestCount + segment.requestCount,
    inputTokens: totals.inputTokens + tokenClasses.inputTokens,
    cachedInputTokens: totals.cachedInputTokens + tokenClasses.cachedInputTokens,
    cacheWriteTokens: totals.cacheWriteTokens + tokenClasses.cacheWriteTokens,
    outputTokens: totals.outputTokens + tokenClasses.outputTokens,
    totalTokens: totals.totalTokens + tokenClasses.totalTokens,
    cacheHitRate: 0,
    reasoningTokens: totals.reasoningTokens + segment.reasoningTokens,
    webSearchRequests: totals.webSearchRequests + segment.webSearchRequests,
  };
  return {...next, cacheHitRate: aggregateCacheHitRate(next)};
}

function aggregateCacheHitRate(
  totals: Pick<UsageTokenTotals, 'inputTokens' | 'cachedInputTokens'>,
): number {
  const totalInputTokens = totals.inputTokens + totals.cachedInputTokens;
  return totalInputTokens === 0 ? 0 : totals.cachedInputTokens / totalInputTokens;
}
