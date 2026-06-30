import {db} from '#db/db.js';
import {runningJobExecutions} from '#db/runner-lease-table.js';
import {
  getFirstJobExecutionByJobId,
  getJobById,
  getWorkflowRunByAttemptId,
} from '#db/workflow-runs.js';
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
  const run = await getWorkflowRunByAttemptId(job.workflowRunAttemptId);
  if (!run) throw new Error('Expected workflow run to exist');
  const runnerSessionId = crypto.randomUUID();

  await insertRunningJobLease({
    workspaceId: run.workspaceId,
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    workflowRunAttemptId: job.workflowRunAttemptId,
    projectId: run.projectId,
    runnerSessionId,
  });

  return await mintLeaseToken({
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    workflowRunAttemptId: params.token?.runId ?? job.workflowRunAttemptId,
    projectId: params.token?.projectId ?? run.projectId,
    workspaceId: params.token?.workspaceId ?? run.workspaceId,
    runnerSessionId,
  });
}

export interface InsertRunningJobLeaseParams {
  workspaceId: string;
  jobId: string;
  jobExecutionId: string;
  runId?: string;
  workflowRunAttemptId?: string;
  projectId: string;
  runnerSessionId: string;
}

export async function insertRunningJobLease(params: InsertRunningJobLeaseParams): Promise<void> {
  const workflowRunAttemptId = params.workflowRunAttemptId ?? params.runId;
  if (!workflowRunAttemptId) throw new Error('Expected workflow run attempt id');
  await db()
    .insert(runningJobExecutions)
    .values({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      workflowRunAttemptId,
      projectId: params.projectId,
      runnerSessionId: params.runnerSessionId,
      requiredLabels: ['linux'],
      runnerLabels: ['linux'],
    });
}
