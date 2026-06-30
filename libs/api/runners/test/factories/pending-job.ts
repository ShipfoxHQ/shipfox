import {Factory} from 'fishery';
import {enqueueJobExecution} from '#db/job-executions.js';

interface PendingJobAttrs {
  workspaceId: string;
  jobId: string;
  jobExecutionId: string;
  workflowRunAttemptId: string;
  projectId: string;
  requiredLabels: string[];
}

export const pendingJobFactory = Factory.define<PendingJobAttrs>(({onCreate}) => {
  const jobId = crypto.randomUUID();
  const jobExecutionId = crypto.randomUUID();
  const workflowRunAttemptId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  onCreate(async (attrs) => {
    await enqueueJobExecution({
      workspaceId: attrs.workspaceId,
      jobId: attrs.jobId,
      jobExecutionId: attrs.jobExecutionId,
      workflowRunAttemptId: attrs.workflowRunAttemptId,
      projectId: attrs.projectId,
      requiredLabels: attrs.requiredLabels,
    });
    return attrs;
  });

  return {
    workspaceId,
    jobId,
    jobExecutionId,
    workflowRunAttemptId,
    projectId,
    requiredLabels: ['linux'],
  };
});
