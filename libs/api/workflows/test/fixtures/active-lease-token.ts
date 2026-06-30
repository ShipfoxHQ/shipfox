import {db} from '#db/db.js';
import {runningJobExecutions} from '#db/runner-lease-table.js';
import {getFirstJobExecutionByJobId, getJobById, getWorkflowRunById} from '#db/workflow-runs.js';
import {mintLeaseToken} from './lease-token.js';

export interface MintActiveLeaseTokenParams {
  jobId: string;
  token?: {
    runId?: string;
    projectId?: string;
    workspaceId?: string;
  };
}

export async function mintActiveLeaseToken(params: MintActiveLeaseTokenParams): Promise<string> {
  const jobExecution = await getFirstJobExecutionByJobId(params.jobId);
  if (!jobExecution) throw new Error('Expected job execution to exist');
  const job = await getJobById(params.jobId);
  if (!job) throw new Error('Expected job to exist');
  const run = await getWorkflowRunById(job.runId);
  if (!run) throw new Error('Expected workflow run to exist');
  const runnerSessionId = crypto.randomUUID();

  await insertRunningJobLease({
    workspaceId: run.workspaceId,
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    runId: run.id,
    projectId: run.projectId,
    runnerSessionId,
  });

  return await mintLeaseToken({
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    runId: params.token?.runId ?? run.id,
    projectId: params.token?.projectId ?? run.projectId,
    workspaceId: params.token?.workspaceId ?? run.workspaceId,
    runnerSessionId,
  });
}

export interface InsertRunningJobLeaseParams {
  workspaceId: string;
  jobId: string;
  jobExecutionId: string;
  runId: string;
  projectId: string;
  runnerSessionId: string;
}

export async function insertRunningJobLease(params: InsertRunningJobLeaseParams): Promise<void> {
  await db()
    .insert(runningJobExecutions)
    .values({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      runId: params.runId,
      projectId: params.projectId,
      runnerSessionId: params.runnerSessionId,
      requiredLabels: ['linux'],
      runnerLabels: ['linux'],
    });
}
