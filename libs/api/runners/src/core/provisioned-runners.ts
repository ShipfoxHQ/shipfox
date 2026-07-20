import type {ProvisionedRunner, ProvisionedRunnerState} from '#core/entities/provisioned-runner.js';
import {
  attachProviderRunnerId as attachProviderRunnerIdDb,
  createPlannedProvisionedCapacity as createPlannedProvisionedCapacityDb,
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
import {
  provisionedRunnerAbsentTerminatedCount,
  provisionedRunnerReconcileCallCount,
  provisionedRunnerReportCount,
  provisionedRunnerTerminateIntentHonoredCount,
  provisionedRunnerTerminateIntentIssuedCount,
  reservationReleasedCount,
} from '#metrics/instance.js';
import {config} from '../config.js';

export interface ReportProvisionedRunnersParams {
  workspaceId: string | null;
  provisionerId: string;
  events: ProvisionedRunnerReportEvent[];
}

export function createPlannedProvisionedCapacity(params: {
  provisionerId: string;
  providerKind: string | null;
  templateKey: string | null;
}): Promise<{capacityId: string}> {
  return createPlannedProvisionedCapacityDb(params);
}

export function attachProviderRunnerId(params: {
  capacityId: string;
  provisionerId: string;
  provisionedRunnerId: string;
}): Promise<boolean> {
  return attachProviderRunnerIdDb(params);
}

export interface ReportProvisionedRunnersResult {
  accepted: number;
  reservationsReleased: number;
}

export interface ReconcileProvisionedRunnersParams {
  workspaceId: string | null;
  provisionerId: string;
  observedProvisionedRunnerIds: string[];
}

export type ReconcileDesiredIntent = 'keep' | 'terminate';
type ReconcileDesiredIntentReason = 'job-cancelled' | 'terminal-state';

export interface ReconciledBoundJobExecution {
  jobId: string;
  jobExecutionId: string;
  workflowRunAttemptId: string;
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
  desiredIntentReason: ReconcileDesiredIntentReason | null;
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
  workflowRunAttemptId: string | null;
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
  for (const intent of result.terminateIntentsHonored) {
    provisionedRunnerTerminateIntentHonoredCount.add(1, {reason: intent.reason});
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
  provisionedRunnerReconcileCallCount.add(1);
  if (result.absentIds.length > 0)
    provisionedRunnerAbsentTerminatedCount.add(result.absentIds.length);

  const runners = reconcileProvisionedRunnersFromDbResult({
    observedProvisionedRunnerIds: params.observedProvisionedRunnerIds,
    observedRows: result.observedRows,
    boundJobExecutionsByProvisionedRunnerId: result.boundJobExecutionsByProvisionedRunnerId,
  });
  for (const runner of runners) {
    if (runner.desiredIntentReason) {
      provisionedRunnerTerminateIntentIssuedCount.add(1, {
        surface: 'reconcile',
        reason: runner.desiredIntentReason,
      });
    }
  }

  return {
    runners,
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

    const desiredIntentReason = getDesiredIntentReason(row, boundJobExecution);

    return {
      provisionedRunnerId,
      state: row?.state ?? null,
      reservationId: row?.reservationId ?? null,
      runnerSessionId: row?.runnerSessionId ?? null,
      boundJobExecution: boundJobExecution
        ? toReconciledBoundJobExecution(boundJobExecution)
        : null,
      desiredIntent: desiredIntentReason ? 'terminate' : 'keep',
      desiredIntentReason,
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
    workflowRunAttemptId: jobExecution.workflowRunAttemptId,
    lastHeartbeatAt: jobExecution.lastHeartbeatAt,
    cancellationRequestedAt: jobExecution.cancellationRequestedAt,
  };
}

export function desiredIntent(
  row: ProvisionedRunner | undefined,
  boundJobExecution: ProvisionedRunnerBoundJobExecution | undefined,
): ReconcileDesiredIntent {
  return getDesiredIntentReason(row, boundJobExecution) ? 'terminate' : 'keep';
}

function getDesiredIntentReason(
  row: ProvisionedRunner | undefined,
  boundJobExecution: ProvisionedRunnerBoundJobExecution | undefined,
): ReconcileDesiredIntentReason | null {
  if (!row) return null;
  if (isTerminalState(row.state)) return 'terminal-state';
  if (boundJobExecution?.cancellationRequestedAt) return 'job-cancelled';
  return null;
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
    workflowRunAttemptId: jobExecution?.workflowRunAttemptId ?? null,
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
