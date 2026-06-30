import {Factory} from 'fishery';
import {enqueueJobExecution} from '#db/job-executions.js';

interface PendingJobAttrs {
  workspaceId: string;
  jobId: string;
  executionId: string;
  runId: string;
  projectId: string;
  requiredLabels: string[];
}

export const pendingJobFactory = Factory.define<PendingJobAttrs>(({onCreate}) => {
  const jobId = crypto.randomUUID();
  const executionId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  onCreate(async (attrs) => {
    await enqueueJobExecution({
      workspaceId: attrs.workspaceId,
      jobId: attrs.jobId,
      executionId: attrs.executionId,
      runId: attrs.runId,
      projectId: attrs.projectId,
      requiredLabels: attrs.requiredLabels,
    });
    return attrs;
  });

  return {
    workspaceId,
    jobId,
    executionId,
    runId,
    projectId,
    requiredLabels: ['linux'],
  };
});
