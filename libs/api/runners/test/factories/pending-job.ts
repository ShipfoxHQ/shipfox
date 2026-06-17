import {Factory} from 'fishery';
import {scheduleJob} from '#db/jobs.js';

interface PendingJobAttrs {
  workspaceId: string;
  jobId: string;
  runId: string;
  projectId: string;
}

export const pendingJobFactory = Factory.define<PendingJobAttrs>(({onCreate}) => {
  const jobId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  onCreate(async (attrs) => {
    await scheduleJob({
      workspaceId: attrs.workspaceId,
      jobId: attrs.jobId,
      runId: attrs.runId,
      projectId: attrs.projectId,
    });
    return attrs;
  });

  return {
    workspaceId,
    jobId,
    runId,
    projectId,
  };
});
