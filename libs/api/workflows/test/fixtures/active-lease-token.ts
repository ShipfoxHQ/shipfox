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
    workflowRunId?: string;
    workflowRunAttemptId?: string;
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
    workflowRunId: run.id,
    workflowRunAttemptId: job.workflowRunAttemptId,
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    projectId: run.projectId,
    runnerSessionId,
  });

  return await mintLeaseToken({
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    workflowRunId: params.token?.workflowRunId ?? run.id,
    workflowRunAttemptId: params.token?.workflowRunAttemptId ?? job.workflowRunAttemptId,
    projectId: params.token?.projectId ?? run.projectId,
    workspaceId: params.token?.workspaceId ?? run.workspaceId,
    runnerSessionId,
  });
}

export interface InsertRunningJobLeaseParams {
  workspaceId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  runnerSessionId: string;
}

export async function insertRunningJobLease(params: InsertRunningJobLeaseParams): Promise<void> {
  await db()
    .insert(runningJobExecutions)
    .values({
      workspaceId: params.workspaceId,
      workflowRunId: params.workflowRunId,
      workflowRunAttemptId: params.workflowRunAttemptId,
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      projectId: params.projectId,
      runnerSessionId: params.runnerSessionId,
      requiredLabels: ['linux'],
      runnerLabels: ['linux'],
    });
}
