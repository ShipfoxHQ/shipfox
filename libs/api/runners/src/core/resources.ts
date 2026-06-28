import type {Resource, ResourceState} from '#core/entities/resource.js';
import {
  listActiveResources,
  listActiveRunningJobs,
  type ResourceReportEvent,
  reportResources as reportResourcesDb,
} from '#db/index.js';
import type {ActiveRunningJob} from '#db/jobs.js';
import {reservationReleasedCount, resourceReportCount} from '#metrics/instance.js';
import {config} from '../config.js';

export interface ReportResourcesParams {
  workspaceId: string;
  provisionerId: string;
  events: ResourceReportEvent[];
}

export interface ReportResourcesResult {
  accepted: number;
  reservationsReleased: number;
}

export type ActiveRunnerState = 'starting' | 'running' | 'stopping' | 'busy';

export interface ActiveRunner {
  runnerSessionId: string | null;
  resourceId: string | null;
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

export async function reportResources(
  params: ReportResourcesParams,
): Promise<ReportResourcesResult> {
  const result = await reportResourcesDb(params);

  for (const event of params.events) {
    resourceReportCount.add(1, {state: event.state});
  }
  if (result.reservationsReleased > 0) reservationReleasedCount.add(result.reservationsReleased);

  return result;
}

export async function listActiveRunners(params: {workspaceId: string}): Promise<ActiveRunner[]> {
  const [resourceRows, jobRows] = await Promise.all([
    listActiveResources({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
    listActiveRunningJobs({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
  ]);

  return mergeActiveRunners(resourceRows, jobRows);
}

function mergeActiveRunners(resources: Resource[], jobs: ActiveRunningJob[]): ActiveRunner[] {
  const jobsByRunnerSessionId = new Map<string, ActiveRunningJob[]>();
  for (const job of jobs) {
    const runnerJobs = jobsByRunnerSessionId.get(job.runnerSessionId) ?? [];
    runnerJobs.push(job);
    jobsByRunnerSessionId.set(job.runnerSessionId, runnerJobs);
  }

  const merged: ActiveRunner[] = [];
  const usedJobIds = new Set<string>();

  for (const resource of resources) {
    const resourceJobs = resource.runnerSessionId
      ? jobsByRunnerSessionId.get(resource.runnerSessionId)
      : undefined;
    if (!resourceJobs || resourceJobs.length === 0) {
      merged.push(toActiveRunner(resource, undefined));
      continue;
    }

    for (const job of resourceJobs) {
      usedJobIds.add(job.jobId);
      merged.push(toActiveRunner(resource, job));
    }
  }

  for (const job of jobs) {
    if (usedJobIds.has(job.jobId)) continue;
    merged.push(toActiveRunner(undefined, job));
  }

  return merged.sort(compareActiveRunners);
}

function toActiveRunner(
  resource: Resource | undefined,
  job: ActiveRunningJob | undefined,
): ActiveRunner {
  return {
    runnerSessionId: resource?.runnerSessionId ?? job?.runnerSessionId ?? null,
    resourceId: resource?.resourceId ?? null,
    provisionerId: resource?.provisionerId ?? null,
    state: job ? 'busy' : toActiveRunnerState(resource?.state ?? 'running'),
    labels: resource?.labels ?? job?.runnerLabels ?? [],
    templateKey: resource?.templateKey ?? null,
    providerKind: resource?.providerKind ?? null,
    jobId: job?.jobId ?? null,
    runId: job?.runId ?? null,
    projectId: job?.projectId ?? null,
    reportedAt: resource?.reportedAt ?? null,
    lastHeartbeatAt: job?.lastHeartbeatAt ?? null,
  };
}

function toActiveRunnerState(state: ResourceState): ActiveRunnerState {
  if (state === 'starting' || state === 'stopping') return state;
  return 'running';
}

function compareActiveRunners(a: ActiveRunner, b: ActiveRunner): number {
  const aTime = Math.max(a.lastHeartbeatAt?.getTime() ?? 0, a.reportedAt?.getTime() ?? 0);
  const bTime = Math.max(b.lastHeartbeatAt?.getTime() ?? 0, b.reportedAt?.getTime() ?? 0);
  return bTime - aTime;
}
