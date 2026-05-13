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
  // The HTTP route already enforces `userContext.canAccess(subscription.workspaceId)`
  // and passes the subscription's workspace id back in, so this branch is
  // unreachable from the route. Kept for direct callers (tests, future
  // internal callers); removing it would make the function trust its
  // arguments more than it should.
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
    // Caller-supplied inputs win; the trigger's configured `with` is the
    // fallback so YAML defaults still apply when the user fires the
    // trigger with no body.
    inputs: params.inputs ?? readConfigInputs(subscription),
  });
}
