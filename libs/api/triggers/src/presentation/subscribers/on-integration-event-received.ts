import type {
  GithubPushPayload,
  IntegrationEventReceivedEvent,
} from '@shipfox/api-integration-core-dto';
import {getProjectBySource} from '@shipfox/api-projects';
import {runWorkflow} from '@shipfox/api-workflows';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {readConfigInputs, readConfigOn} from '#core/config.js';
import {matchPushBranch} from '#core/match/match-push.js';
import {findMatchingSubscriptions} from '#db/subscriptions.js';

const GITHUB_SOURCE = 'github';
const PUSH_EVENT = 'push';

export async function onIntegrationEventReceived(event: DomainEvent): Promise<void> {
  const envelope = event.payload as IntegrationEventReceivedEvent;

  if (envelope.source !== GITHUB_SOURCE || envelope.event !== PUSH_EVENT) {
    return;
  }
  const pushPayload = envelope.payload as GithubPushPayload;

  const project = await getProjectBySource({
    workspaceId: envelope.workspaceId,
    sourceConnectionId: envelope.connectionId,
    sourceExternalRepositoryId: pushPayload.externalRepositoryId,
  });
  if (!project) {
    logger().info(
      {
        eventId: event.id,
        connectionId: envelope.connectionId,
        externalRepositoryId: pushPayload.externalRepositoryId,
      },
      'triggers: no project bound to source, dropping',
    );
    return;
  }

  const subscriptions = await findMatchingSubscriptions({
    workspaceId: envelope.workspaceId,
    projectId: project.id,
    source: envelope.source,
    event: envelope.event,
  });

  for (const subscription of subscriptions) {
    if (!matchPushBranch(pushPayload.ref, readConfigOn(subscription))) continue;

    await runWorkflow({
      workspaceId: project.workspaceId,
      projectId: project.id,
      definitionId: subscription.workflowDefinitionId,
      triggerPayload: {
        source: 'github',
        event: 'push',
        subscriptionId: subscription.id,
        deliveryId: envelope.deliveryId,
        ref: pushPayload.ref,
        headCommitSha: pushPayload.headCommitSha,
        defaultBranch: pushPayload.defaultBranch,
        isDefaultBranch: pushPayload.isDefaultBranch,
        externalRepositoryId: pushPayload.externalRepositoryId,
      },
      inputs: readConfigInputs(subscription),
      triggerIdempotencyKey: `${subscription.id}:${event.id}`,
    });
  }
}
