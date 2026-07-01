import type {WorkflowsJobTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {removeJobListenerSubscriptionsForJob} from '#db/job-listener-subscriptions.js';

export async function onJobTerminated(payload: WorkflowsJobTerminatedEventDto): Promise<void> {
  await removeJobListenerSubscriptionsForJob(payload.jobId);
}
