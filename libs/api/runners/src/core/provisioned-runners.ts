import type {ProvisionedRunner, ProvisionedRunnerState} from '#core/entities/provisioned-runner.js';
import {
  isTerminalState,
  listActiveProvisionedRunners,
  listActiveRunningJobExecutions,
  type ProvisionedRunnerReportEvent,
  reconcileProvisionedRunners as reconcileProvisionedRunnersDb,
  reportProvisionedRunners as reportProvisionedRunnersDb,
} from '#db/index.js';
import type {
  ActiveRunningJobExecution,
  ProvisionedRunnerBoundJobExecution,
} from '#db/job-executions.js';
import {provisionedRunnerReportCount, reservationReleasedCount} from '#metrics/instance.js';
import {config} from '../config.js';

export interface ReportProvisionedRunnersParams {
  workspaceId: string;
  provisionerId: string;
  events: ProvisionedRunnerReportEvent[];
}

export interface ReportProvisionedRunnersResult {
  accepted: number;
  reservationsReleased: number;
}

export interface ReconcileProvisionedRunnersParams {
  workspaceId: string;
  provisionerId: string;
  observedProvisionedRunnerIds: string[];
}

export type ReconcileDesiredIntent = 'keep' | 'terminate';

export interface ReconciledBoundJobExecution {
  jobId: string;
  jobExecutionId: string;
  runId: string;
  lastHeartbeatAt: Date;
  cancellationRequestedAt: Date | null;
}

export interface ReconciledProvisionedRunner {
  provisionedRunnerId: string;
  state: ProvisionedRunnerState | null;
  reservationId: string | null;
  runnerSessionId: string | null;
  boundJobExecution: ReconciledBoundJobExecution | null;
  desiredIntent: ReconcileDesiredIntent;
}

export interface ReconcileProvisionedRunnersResult {
  runners: ReconciledProvisionedRunner[];
  terminatedAbsentProvisionedRunnerIds: string[];
}

export type ActiveRunnerState = 'starting' | 'running' | 'stopping' | 'busy';

export interface ActiveRunner {
  runnerSessionId: string | null;
  provisionedRunnerId: string | null;
  provisionerId: string | null;
  state: ActiveRunnerState;
  labels: string[];
  templateKey: string | null;
  providerKind: string | null;
  jobId: string | null;
  runId: string | null;
  projectId: string | null;
  reportedAt: Date | null;
  lastHeartbeatAt: Date | null;
}

export async function reportProvisionedRunners(
  params: ReportProvisionedRunnersParams,
): Promise<ReportProvisionedRunnersResult> {
  const result = await reportProvisionedRunnersDb(params);

  for (const event of params.events) {
    provisionedRunnerReportCount.add(1, {state: event.state});
  }
  if (result.reservationsReleased > 0) reservationReleasedCount.add(result.reservationsReleased);

  return result;
}

export async function reconcileProvisionedRunners(
  params: ReconcileProvisionedRunnersParams,
): Promise<ReconcileProvisionedRunnersResult> {
  const result = await reconcileProvisionedRunnersDb({
    ...params,
    terminateGraceSeconds: config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS,
  });

  if (result.reservationsReleased > 0) reservationReleasedCount.add(result.reservationsReleased);

  return {
    runners: reconcileProvisionedRunnersFromDbResult({
      observedProvisionedRunnerIds: params.observedProvisionedRunnerIds,
      observedRows: result.observedRows,
      boundJobExecutionsByProvisionedRunnerId: result.boundJobExecutionsByProvisionedRunnerId,
    }),
    terminatedAbsentProvisionedRunnerIds: result.absentIds,
  };
}

export function reconcileProvisionedRunnersFromDbResult(params: {
  observedProvisionedRunnerIds: string[];
  observedRows: ProvisionedRunner[];
  boundJobExecutionsByProvisionedRunnerId: Map<string, ProvisionedRunnerBoundJobExecution>;
}): ReconciledProvisionedRunner[] {
  const rowsByProvisionedRunnerId = new Map(
    params.observedRows.map((row) => [row.provisionedRunnerId, row]),
  );

  return params.observedProvisionedRunnerIds.map((provisionedRunnerId) => {
    const row = rowsByProvisionedRunnerId.get(provisionedRunnerId);
    const boundJobExecution =
      params.boundJobExecutionsByProvisionedRunnerId.get(provisionedRunnerId);

    return {
      provisionedRunnerId,
      state: row?.state ?? null,
      reservationId: row?.reservationId ?? null,
      runnerSessionId: row?.runnerSessionId ?? null,
      boundJobExecution: boundJobExecution
        ? toReconciledBoundJobExecution(boundJobExecution)
        : null,
      desiredIntent: desiredIntent(row, boundJobExecution),
    };
  });
}

export async function listActiveRunners(params: {workspaceId: string}): Promise<ActiveRunner[]> {
  const [provisionedRunnerRows, jobExecutionRows] = await Promise.all([
    listActiveProvisionedRunners({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
    listActiveRunningJobExecutions({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
  ]);

  return mergeActiveRunners(provisionedRunnerRows, jobExecutionRows);
}

function toReconciledBoundJobExecution(
  jobExecution: ProvisionedRunnerBoundJobExecution,
): ReconciledBoundJobExecution {
  return {
    jobId: jobExecution.jobId,
    jobExecutionId: jobExecution.jobExecutionId,
    runId: jobExecution.runId,
    lastHeartbeatAt: jobExecution.lastHeartbeatAt,
    cancellationRequestedAt: jobExecution.cancellationRequestedAt,
  };
}

export function desiredIntent(
  row: ProvisionedRunner | undefined,
  boundJobExecution: ProvisionedRunnerBoundJobExecution | undefined,
): ReconcileDesiredIntent {
  if (!row) return 'keep';
  if (isTerminalState(row.state)) return 'terminate';
  if (boundJobExecution?.cancellationRequestedAt) return 'terminate';
  return 'keep';
}

function mergeActiveRunners(
  provisionedRunners: ProvisionedRunner[],
  jobExecutions: ActiveRunningJobExecution[],
): ActiveRunner[] {
  const jobExecutionsByRunnerSessionId = new Map<string, ActiveRunningJobExecution[]>();
  const jobExecutionsByProvisionedRunnerId = new Map<string, ActiveRunningJobExecution[]>();
  for (const jobExecution of jobExecutions) {
    const runnerJobExecutions =
      jobExecutionsByRunnerSessionId.get(jobExecution.runnerSessionId) ?? [];
    runnerJobExecutions.push(jobExecution);
    jobExecutionsByRunnerSessionId.set(jobExecution.runnerSessionId, runnerJobExecutions);

    if (jobExecution.provisionerId && jobExecution.provisionedRunnerId) {
      const key = provisionedRunnerKey(
        jobExecution.provisionerId,
        jobExecution.provisionedRunnerId,
      );
      const provisionedRunnerJobExecutions = jobExecutionsByProvisionedRunnerId.get(key) ?? [];
      provisionedRunnerJobExecutions.push(jobExecution);
      jobExecutionsByProvisionedRunnerId.set(key, provisionedRunnerJobExecutions);
    }
  }

  const merged: ActiveRunner[] = [];
  const usedJobExecutionIds = new Set<string>();

  for (const provisionedRunner of provisionedRunners) {
    const provisionedRunnerJobExecutions =
      jobExecutionsByProvisionedRunnerId.get(
        provisionedRunnerKey(
          provisionedRunner.provisionerId,
          provisionedRunner.provisionedRunnerId,
        ),
      ) ??
      (provisionedRunner.runnerSessionId
        ? jobExecutionsByRunnerSessionId.get(provisionedRunner.runnerSessionId)
        : undefined);
    if (!provisionedRunnerJobExecutions || provisionedRunnerJobExecutions.length === 0) {
      merged.push(toActiveRunner(provisionedRunner, undefined));
      continue;
    }

    let emitted = false;
    for (const jobExecution of provisionedRunnerJobExecutions) {
      if (usedJobExecutionIds.has(jobExecution.jobExecutionId)) continue;
      usedJobExecutionIds.add(jobExecution.jobExecutionId);
      merged.push(toActiveRunner(provisionedRunner, jobExecution));
      emitted = true;
    }
    if (!emitted) merged.push(toActiveRunner(provisionedRunner, undefined));
  }

  for (const jobExecution of jobExecutions) {
    if (usedJobExecutionIds.has(jobExecution.jobExecutionId)) continue;
    merged.push(toActiveRunner(undefined, jobExecution));
  }

  return merged.sort(compareActiveRunners);
}

function provisionedRunnerKey(provisionerId: string, provisionedRunnerId: string): string {
  return `${provisionerId}:${provisionedRunnerId}`;
}

function toActiveRunner(
  provisionedRunner: ProvisionedRunner | undefined,
  jobExecution: ActiveRunningJobExecution | undefined,
): ActiveRunner {
  return {
    runnerSessionId: provisionedRunner?.runnerSessionId ?? jobExecution?.runnerSessionId ?? null,
    provisionedRunnerId:
      provisionedRunner?.provisionedRunnerId ?? jobExecution?.provisionedRunnerId ?? null,
    provisionerId: provisionedRunner?.provisionerId ?? jobExecution?.provisionerId ?? null,
    state: jobExecution ? 'busy' : toActiveRunnerState(provisionedRunner?.state ?? 'running'),
    labels: provisionedRunner?.labels ?? jobExecution?.runnerLabels ?? [],
    templateKey: provisionedRunner?.templateKey ?? null,
    providerKind: provisionedRunner?.providerKind ?? null,
    jobId: jobExecution?.jobId ?? null,
    runId: jobExecution?.runId ?? null,
    projectId: jobExecution?.projectId ?? null,
    reportedAt: provisionedRunner?.reportedAt ?? null,
    lastHeartbeatAt: jobExecution?.lastHeartbeatAt ?? null,
  };
}

function toActiveRunnerState(state: ProvisionedRunnerState): ActiveRunnerState {
  if (state === 'starting' || state === 'stopping') return state;
  return 'running';
}

function compareActiveRunners(a: ActiveRunner, b: ActiveRunner): number {
  const aTime = Math.max(a.lastHeartbeatAt?.getTime() ?? 0, a.reportedAt?.getTime() ?? 0);
  const bTime = Math.max(b.lastHeartbeatAt?.getTime() ?? 0, b.reportedAt?.getTime() ?? 0);
  return bTime - aTime;
}
