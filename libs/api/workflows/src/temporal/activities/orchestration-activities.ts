import {scheduleJob} from '@shipfox/api-runners';
import type {StepResultDto} from '@shipfox/api-runners-dto';
import type {JobStatus} from '#core/entities/job.js';
import type {RuntimeDagJob} from '#core/entities/runtime-dag.js';
import type {StepStatus} from '#core/entities/step.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {
  applyStepResults,
  bulkUpdateStepStatuses,
  failJobAsTimedOut,
  getJobsByRunId,
  getStepsByJobIds,
  getWorkflowRunById,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/index.js';

export interface DagJob extends RuntimeDagJob {
  id: string;
  name: string;
  status: string;
  dependencies: string[];
  version: number;
  steps: Array<{
    id: string;
    name: string | null;
    type: string;
    config: Record<string, unknown>;
    position: number;
  }>;
}

export interface RunDag {
  runId: string;
  workspaceId: string;
  runVersion: number;
  jobs: DagJob[];
}

export async function loadRunDag(runId: string): Promise<RunDag> {
  const run = await getWorkflowRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const jobs = await getJobsByRunId(runId);
  const jobIds = jobs.map((j) => j.id);
  const allSteps = await getStepsByJobIds(jobIds);

  const stepsByJobId = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    const arr = stepsByJobId.get(step.jobId) ?? [];
    arr.push(step);
    stepsByJobId.set(step.jobId, arr);
  }

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    runVersion: run.version,
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      dependencies: job.dependencies,
      version: job.version,
      steps: (stepsByJobId.get(job.id) ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        config: s.config,
        position: s.position,
      })),
    })),
  };
}

export async function setRunStatus(params: {
  runId: string;
  status: WorkflowRunStatus;
  version: number;
}): Promise<{newVersion: number}> {
  const updated = await updateWorkflowRunStatus({
    runId: params.runId,
    status: params.status,
    expectedVersion: params.version,
  });
  return {newVersion: updated.version};
}

export async function setJobStatus(params: {
  jobId: string;
  status: JobStatus;
  version: number;
}): Promise<{newVersion: number}> {
  const updated = await updateJobStatus({
    jobId: params.jobId,
    status: params.status,
    expectedVersion: params.version,
  });
  return {newVersion: updated.version};
}

export async function bulkSetStepStatuses(params: {
  jobId: string;
  status: StepStatus;
}): Promise<void> {
  await bulkUpdateStepStatuses(params);
}

// Wire (snake_case) → domain (camelCase) at the activity boundary so DB code
// never sees the external shape. The completionStatus is forwarded so the
// activity can enforce strict consistency for succeeded jobs.
export async function applyStepResultsActivity(params: {
  jobId: string;
  completionStatus: 'succeeded' | 'failed';
  reportedSteps: StepResultDto[];
}): Promise<void> {
  await applyStepResults({
    jobId: params.jobId,
    completionStatus: params.completionStatus,
    reportedSteps: params.reportedSteps.map((s) => ({
      stepId: s.step_id,
      status: s.status,
      error:
        s.error == null
          ? null
          : {
              message: s.error.message,
              ...(s.error.exit_code !== undefined ? {exitCode: s.error.exit_code} : {}),
              ...(s.error.signal !== undefined ? {signal: s.error.signal} : {}),
            },
    })),
  });
}

export async function enqueueJobForRunner(params: {
  workspaceId: string;
  jobId: string;
  runId: string;
}): Promise<void> {
  await scheduleJob({
    workspaceId: params.workspaceId,
    jobId: params.jobId,
    runId: params.runId,
  });
}

export async function failJobAsTimedOutActivity(params: {
  jobId: string;
  runId: string;
  expectedVersion: number;
}): Promise<{newVersion: number}> {
  const job = await failJobAsTimedOut(params);
  return {newVersion: job.version};
}
