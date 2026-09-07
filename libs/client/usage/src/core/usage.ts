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

export interface UsageReportedTokenTotals {
  dialect: UsageInferenceDialect;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  webSearchRequests: number;
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
  upstream: string;
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
  reportedTokenCounts: readonly UsageReportedTokenTotals[];
}

export interface UsageModelTotals extends UsageTokenTotals {
  model: string;
}

export interface UsageRunSummary {
  computeSeconds: number;
  totals: UsageTokenTotals;
  byModel: UsageModelTotals[];
}

export interface StepInferenceUsage extends UsageTokenTotals {
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
  upstream: string;
  model: string;
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
    reportedTokenCounts: [],
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

export function groupInferenceSegmentsByStepAttempt(
  segments: readonly UsageInferenceSegment[],
): StepInferenceUsage[] {
  const grouped = new Map<string, StepInferenceUsage>();
  for (const segment of segments) {
    const key = JSON.stringify([segment.stepAttemptId, segment.upstream, segment.model]);
    const current = grouped.get(key);
    if (current) {
      addUsageTokenTotalsInPlace(current, segment);
      continue;
    }
    grouped.set(key, {
      jobExecutionId: segment.jobExecutionId,
      stepId: segment.stepId,
      stepAttemptId: segment.stepAttemptId,
      upstream: segment.upstream,
      model: segment.model,
      ...addUsageTokenTotals(emptyUsageTokenTotals(), segment),
    });
  }

  return [...grouped.values()].sort(
    (left, right) =>
      left.stepId.localeCompare(right.stepId) ||
      left.stepAttemptId.localeCompare(right.stepAttemptId) ||
      left.upstream.localeCompare(right.upstream) ||
      left.model.localeCompare(right.model),
  );
}

function addUsageTokenTotals(
  totals: UsageTokenTotals,
  segment: Pick<
    UsageInferenceSegment,
    | 'dialect'
    | 'requestCount'
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheCreationTokens'
    | 'cacheReadTokens'
    | 'reasoningTokens'
    | 'webSearchRequests'
    | 'tokenClasses'
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
    reportedTokenCounts: addReportedTokenTotals(totals.reportedTokenCounts, segment),
  };
  return {...next, cacheHitRate: aggregateCacheHitRate(next)};
}

function addUsageTokenTotalsInPlace(
  totals: UsageTokenTotals,
  segment: Pick<
    UsageInferenceSegment,
    | 'dialect'
    | 'requestCount'
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheCreationTokens'
    | 'cacheReadTokens'
    | 'reasoningTokens'
    | 'webSearchRequests'
    | 'tokenClasses'
  >,
): void {
  const {tokenClasses} = segment;
  totals.requestCount += segment.requestCount;
  totals.inputTokens += tokenClasses.inputTokens;
  totals.cachedInputTokens += tokenClasses.cachedInputTokens;
  totals.cacheWriteTokens += tokenClasses.cacheWriteTokens;
  totals.outputTokens += tokenClasses.outputTokens;
  totals.totalTokens += tokenClasses.totalTokens;
  totals.reasoningTokens += segment.reasoningTokens;
  totals.webSearchRequests += segment.webSearchRequests;
  totals.reportedTokenCounts = addReportedTokenTotals(totals.reportedTokenCounts, segment);
  totals.cacheHitRate = aggregateCacheHitRate(totals);
}

function addReportedTokenTotals(
  reportedTokenCounts: readonly UsageReportedTokenTotals[],
  segment: Pick<
    UsageInferenceSegment,
    | 'dialect'
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheCreationTokens'
    | 'cacheReadTokens'
    | 'reasoningTokens'
    | 'webSearchRequests'
  >,
): readonly UsageReportedTokenTotals[] {
  const current = reportedTokenCounts.find(({dialect}) => dialect === segment.dialect);
  if (!current) {
    return [
      ...reportedTokenCounts,
      {
        dialect: segment.dialect,
        inputTokens: segment.inputTokens,
        outputTokens: segment.outputTokens,
        cacheCreationTokens: segment.cacheCreationTokens,
        cacheReadTokens: segment.cacheReadTokens,
        reasoningTokens: segment.reasoningTokens,
        webSearchRequests: segment.webSearchRequests,
      },
    ];
  }

  return reportedTokenCounts.map((reported) =>
    reported.dialect === segment.dialect
      ? {
          ...reported,
          inputTokens: reported.inputTokens + segment.inputTokens,
          outputTokens: reported.outputTokens + segment.outputTokens,
          cacheCreationTokens: reported.cacheCreationTokens + segment.cacheCreationTokens,
          cacheReadTokens: reported.cacheReadTokens + segment.cacheReadTokens,
          reasoningTokens: reported.reasoningTokens + segment.reasoningTokens,
          webSearchRequests: reported.webSearchRequests + segment.webSearchRequests,
        }
      : reported,
  );
}

function aggregateCacheHitRate(
  totals: Pick<UsageTokenTotals, 'inputTokens' | 'cachedInputTokens'>,
): number {
  const totalInputTokens = totals.inputTokens + totals.cachedInputTokens;
  return totalInputTokens === 0 ? 0 : totals.cachedInputTokens / totalInputTokens;
}
