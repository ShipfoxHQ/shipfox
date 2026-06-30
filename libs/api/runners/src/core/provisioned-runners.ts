import type {ProvisionedRunner, ProvisionedRunnerState} from '#core/entities/provisioned-runner.js';
import {
  listActiveProvisionedRunners,
  listActiveRunningJobs,
  type ProvisionedRunnerReportEvent,
  reconcileProvisionedRunners as reconcileProvisionedRunnersDb,
  reportProvisionedRunners as reportProvisionedRunnersDb,
} from '#db/index.js';
import type {ActiveRunningJob, ProvisionedRunnerBoundJob} from '#db/jobs.js';
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

export interface ReconciledBoundJob {
  jobId: string;
  runId: string;
  lastHeartbeatAt: Date;
  cancellationRequestedAt: Date | null;
}

export interface ReconciledProvisionedRunner {
  provisionedRunnerId: string;
  state: ProvisionedRunnerState | null;
  reservationId: string | null;
  runnerSessionId: string | null;
  boundJob: ReconciledBoundJob | null;
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
      boundJobsByProvisionedRunnerId: result.boundJobsByProvisionedRunnerId,
    }),
    terminatedAbsentProvisionedRunnerIds: result.absentIds,
  };
}

export function reconcileProvisionedRunnersFromDbResult(params: {
  observedProvisionedRunnerIds: string[];
  observedRows: ProvisionedRunner[];
  boundJobsByProvisionedRunnerId: Map<string, ProvisionedRunnerBoundJob>;
}): ReconciledProvisionedRunner[] {
  const rowsByProvisionedRunnerId = new Map(
    params.observedRows.map((row) => [row.provisionedRunnerId, row]),
  );

  return params.observedProvisionedRunnerIds.map((provisionedRunnerId) => {
    const row = rowsByProvisionedRunnerId.get(provisionedRunnerId);
    const boundJob = params.boundJobsByProvisionedRunnerId.get(provisionedRunnerId);

    return {
      provisionedRunnerId,
      state: row?.state ?? null,
      reservationId: row?.reservationId ?? null,
      runnerSessionId: row?.runnerSessionId ?? null,
      boundJob: boundJob ? toReconciledBoundJob(boundJob) : null,
      desiredIntent: row ? desiredIntentForState(row.state) : 'keep',
    };
  });
}

export async function listActiveRunners(params: {workspaceId: string}): Promise<ActiveRunner[]> {
  const [provisionedRunnerRows, jobRows] = await Promise.all([
    listActiveProvisionedRunners({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
    listActiveRunningJobs({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
  ]);

  return mergeActiveRunners(provisionedRunnerRows, jobRows);
}

function toReconciledBoundJob(job: ProvisionedRunnerBoundJob): ReconciledBoundJob {
  return {
    jobId: job.jobId,
    runId: job.runId,
    lastHeartbeatAt: job.lastHeartbeatAt,
    cancellationRequestedAt: job.cancellationRequestedAt,
  };
}

function desiredIntentForState(state: ProvisionedRunnerState): ReconcileDesiredIntent {
  if (state === 'starting' || state === 'running' || state === 'stopping') return 'keep';
  return 'terminate';
}

function mergeActiveRunners(
  provisionedRunners: ProvisionedRunner[],
  jobs: ActiveRunningJob[],
): ActiveRunner[] {
  const jobsByRunnerSessionId = new Map<string, ActiveRunningJob[]>();
  const jobsByProvisionedRunnerId = new Map<string, ActiveRunningJob[]>();
  for (const job of jobs) {
    const runnerJobs = jobsByRunnerSessionId.get(job.runnerSessionId) ?? [];
    runnerJobs.push(job);
    jobsByRunnerSessionId.set(job.runnerSessionId, runnerJobs);

    if (job.provisionerId && job.provisionedRunnerId) {
      const key = provisionedRunnerKey(job.provisionerId, job.provisionedRunnerId);
      const provisionedRunnerJobs = jobsByProvisionedRunnerId.get(key) ?? [];
      provisionedRunnerJobs.push(job);
      jobsByProvisionedRunnerId.set(key, provisionedRunnerJobs);
    }
  }

  const merged: ActiveRunner[] = [];
  const usedJobIds = new Set<string>();

  for (const provisionedRunner of provisionedRunners) {
    const provisionedRunnerJobs =
      jobsByProvisionedRunnerId.get(
        provisionedRunnerKey(
          provisionedRunner.provisionerId,
          provisionedRunner.provisionedRunnerId,
        ),
      ) ??
      (provisionedRunner.runnerSessionId
        ? jobsByRunnerSessionId.get(provisionedRunner.runnerSessionId)
        : undefined);
    if (!provisionedRunnerJobs || provisionedRunnerJobs.length === 0) {
      merged.push(toActiveRunner(provisionedRunner, undefined));
      continue;
    }

    let emitted = false;
    for (const job of provisionedRunnerJobs) {
      if (usedJobIds.has(job.jobId)) continue;
      usedJobIds.add(job.jobId);
      merged.push(toActiveRunner(provisionedRunner, job));
      emitted = true;
    }
    if (!emitted) merged.push(toActiveRunner(provisionedRunner, undefined));
  }

  for (const job of jobs) {
    if (usedJobIds.has(job.jobId)) continue;
    merged.push(toActiveRunner(undefined, job));
  }

  return merged.sort(compareActiveRunners);
}

function provisionedRunnerKey(provisionerId: string, provisionedRunnerId: string): string {
  return `${provisionerId}:${provisionedRunnerId}`;
}

function toActiveRunner(
  provisionedRunner: ProvisionedRunner | undefined,
  job: ActiveRunningJob | undefined,
): ActiveRunner {
  return {
    runnerSessionId: provisionedRunner?.runnerSessionId ?? job?.runnerSessionId ?? null,
    provisionedRunnerId: provisionedRunner?.provisionedRunnerId ?? job?.provisionedRunnerId ?? null,
    provisionerId: provisionedRunner?.provisionerId ?? job?.provisionerId ?? null,
    state: job ? 'busy' : toActiveRunnerState(provisionedRunner?.state ?? 'running'),
    labels: provisionedRunner?.labels ?? job?.runnerLabels ?? [],
    templateKey: provisionedRunner?.templateKey ?? null,
    providerKind: provisionedRunner?.providerKind ?? null,
    jobId: job?.jobId ?? null,
    runId: job?.runId ?? null,
    projectId: job?.projectId ?? null,
    reportedAt: provisionedRunner?.reportedAt ?? null,
    lastHeartbeatAt: job?.lastHeartbeatAt ?? null,
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
