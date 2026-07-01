import type {WorkflowsJobActivatedEventDto} from '@shipfox/api-workflows-dto';
import {projectJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

export async function onJobActivated(payload: WorkflowsJobActivatedEventDto): Promise<void> {
  if (payload.mode !== 'listening') return;

  await projectJobListenerSubscriptions({
    workspaceId: payload.workspaceId,
    workflowRunId: payload.workflowRunId,
    jobId: payload.jobId,
    on: payload.on,
    until: payload.until,
  });
}
