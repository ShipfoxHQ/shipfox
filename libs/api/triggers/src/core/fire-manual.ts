import {runWorkflow, type WorkflowRun} from '@shipfox/api-workflows';
import {getTriggerSubscriptionById} from '#db/subscriptions.js';
import {readConfigInputs} from './config.js';
import {
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from './errors.js';

export interface FireManualSubscriptionParams {
  subscriptionId: string;
  callerWorkspaceId: string;
  userId: string;
  inputs?: Record<string, unknown> | undefined;
}

export async function fireManualSubscription(
  params: FireManualSubscriptionParams,
): Promise<WorkflowRun> {
  const subscription = await getTriggerSubscriptionById(params.subscriptionId);
  if (!subscription) throw new TriggerSubscriptionNotFoundError(params.subscriptionId);
  if (subscription.source !== 'manual') {
    throw new TriggerSubscriptionNotManualError(params.subscriptionId, subscription.source);
  }
  // Defence in depth: unreachable from the HTTP route, but required for any direct caller.
  if (subscription.workspaceId !== params.callerWorkspaceId) {
    throw new TriggerWorkspaceMismatchError(
      params.subscriptionId,
      subscription.workspaceId,
      params.callerWorkspaceId,
    );
  }

  return await runWorkflow({
    workspaceId: subscription.workspaceId,
    projectId: subscription.projectId,
    definitionId: subscription.workflowDefinitionId,
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: subscription.id,
      userId: params.userId,
    },
    inputs: params.inputs ?? readConfigInputs(subscription),
  });
}
