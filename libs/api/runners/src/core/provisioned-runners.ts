import type {ProvisionedRunner, ProvisionedRunnerState} from '#core/entities/provisioned-runner.js';
import {
  listActiveProvisionedRunners,
  listActiveRunningJobs,
  type ProvisionedRunnerReportEvent,
  reportProvisionedRunners as reportProvisionedRunnersDb,
} from '#db/index.js';
import type {ActiveRunningJob} from '#db/jobs.js';
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

function mergeActiveRunners(
  provisionedRunners: ProvisionedRunner[],
  jobs: ActiveRunningJob[],
): ActiveRunner[] {
  const jobsByRunnerSessionId = new Map<string, ActiveRunningJob[]>();
  for (const job of jobs) {
    const runnerJobs = jobsByRunnerSessionId.get(job.runnerSessionId) ?? [];
    runnerJobs.push(job);
    jobsByRunnerSessionId.set(job.runnerSessionId, runnerJobs);
  }

  const merged: ActiveRunner[] = [];
  const usedJobIds = new Set<string>();

  for (const provisionedRunner of provisionedRunners) {
    const provisionedRunnerJobs = provisionedRunner.runnerSessionId
      ? jobsByRunnerSessionId.get(provisionedRunner.runnerSessionId)
      : undefined;
    if (!provisionedRunnerJobs || provisionedRunnerJobs.length === 0) {
      merged.push(toActiveRunner(provisionedRunner, undefined));
      continue;
    }

    for (const job of provisionedRunnerJobs) {
      usedJobIds.add(job.jobId);
      merged.push(toActiveRunner(provisionedRunner, job));
    }
  }

  for (const job of jobs) {
    if (usedJobIds.has(job.jobId)) continue;
    merged.push(toActiveRunner(undefined, job));
  }

  return merged.sort(compareActiveRunners);
}

function toActiveRunner(
  provisionedRunner: ProvisionedRunner | undefined,
  job: ActiveRunningJob | undefined,
): ActiveRunner {
  return {
    runnerSessionId: provisionedRunner?.runnerSessionId ?? job?.runnerSessionId ?? null,
    provisionedRunnerId: provisionedRunner?.provisionedRunnerId ?? null,
    provisionerId: provisionedRunner?.provisionerId ?? null,
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
