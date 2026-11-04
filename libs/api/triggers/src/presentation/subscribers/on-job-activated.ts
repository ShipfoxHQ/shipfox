import type {WorkflowsJobActivatedEventDto} from '@shipfox/api-workflows-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {projectJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

export async function onJobActivated(payload: WorkflowsJobActivatedEventDto): Promise<void> {
  if (payload.mode !== 'listening') return;

  try {
    await projectJobListenerSubscriptions({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      workflowRunId: payload.workflowRunId,
      jobId: payload.jobId,
      on: payload.on,
      until: payload.until,
    });
  } catch (error) {
    if (error instanceof ScopeDeletedError) return;
    throw error;
  }
}
