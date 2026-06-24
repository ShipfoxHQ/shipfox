import {randomUUID} from 'node:crypto';
import {isPermanentRunWorkflowError, runWorkflow, type WorkflowRun} from '@shipfox/api-workflows';
import {getTriggerSubscriptionById} from '#db/subscriptions.js';
import {
  eventOutcomeCount,
  eventReceivedCount,
  subscriptionTriggeredCount,
} from '#metrics/instance.js';
import {readConfigInputs} from './config.js';
import {
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from './errors.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';

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

  // Manual fires have no upstream event id. Use the run id after success; failed
  // attempts need a synthesized ref because there is no run to key on.
  const historyBase = {
    origin: 'manual' as const,
    workspaceId: subscription.workspaceId,
    source: subscription.source,
    event: subscription.event,
    deliveryId: null,
    connectionId: null,
    payload: null,
    receivedAt: new Date(),
  };

  eventReceivedCount.add(1, {source: 'manual'});

  let run: WorkflowRun;
  try {
    run = await runWorkflow({
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
  } catch (error) {
    const failure = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await failure.errored(subscription, toReason(error));
    if (isPermanentRunWorkflowError(error)) {
      eventOutcomeCount.add(1, {source: 'manual', outcome: 'errored'});
      await failure.allErrored(1);
    } else {
      eventOutcomeCount.add(1, {source: 'manual', outcome: 'failed'});
      await failure.failed(1);
    }
    throw error;
  }

  const history = await beginTriggerHistory({...historyBase, eventRef: run.id});
  await history.triggered(subscription, run);
  subscriptionTriggeredCount.add(1, {source: 'manual'});
  eventOutcomeCount.add(1, {source: 'manual', outcome: 'routed'});
  await history.routed(1);
  return run;
}
