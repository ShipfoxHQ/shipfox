import {
  LINEAR_PROVIDER,
  type LinearWebhookBaseEnvelopeDto,
  type LinearWebhookEnvelopeDto,
  type LinearWebhookEventName,
  linearWebhookEnvelopeSchema,
} from '@shipfox/api-integration-linear-dto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {AcknowledgeLinearAgentSession} from '#core/agent-session-acknowledgement.js';
import {getLinearInstallationByOrganizationId} from '#db/installations.js';

export interface HandleLinearWebhookParams {
  tx: IntegrationTx;
  deliveryId: string;
  payload: LinearWebhookBaseEnvelopeDto;
  rawPayload: unknown;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  /** Posts the first activity of a new agent session. Not awaited, so it never delays the webhook. */
  acknowledgeAgentSession?: AcknowledgeLinearAgentSession | undefined;
}

export type HandleLinearWebhookOutcome =
  | 'published'
  | 'duplicate'
  | 'unknown-organization'
  | 'revoked-installation'
  | 'missing-connection'
  | 'inactive-connection'
  | 'unsupported-event';

export async function handleLinearWebhook(
  params: HandleLinearWebhookParams,
): Promise<{outcome: HandleLinearWebhookOutcome}> {
  const installation = await getLinearInstallationByOrganizationId(params.payload.organizationId, {
    tx: params.tx,
  });
  if (!installation) {
    logger().warn(
      {deliveryId: params.deliveryId, organizationId: params.payload.organizationId},
      'linear webhook: unknown organization, dropping',
    );
    await recordDeliveryOnly(params);
    return {outcome: 'unknown-organization'};
  }

  if (installation.status !== 'installed') {
    logger().info(
      {
        deliveryId: params.deliveryId,
        organizationId: params.payload.organizationId,
        connectionId: installation.connectionId,
        status: installation.status,
      },
      'linear webhook: installation is not installed, dropping',
    );
    await recordDeliveryOnly(params);
    return {outcome: 'revoked-installation'};
  }

  const connection = await params.getIntegrationConnectionById(installation.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    logger().warn(
      {
        deliveryId: params.deliveryId,
        organizationId: params.payload.organizationId,
        connectionId: installation.connectionId,
      },
      'linear webhook: installation has no connection, dropping',
    );
    await recordDeliveryOnly(params);
    return {outcome: 'missing-connection'};
  }

  if (connection.lifecycleStatus !== 'active') {
    const logContext = {
      deliveryId: params.deliveryId,
      organizationId: params.payload.organizationId,
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      lifecycleStatus: connection.lifecycleStatus,
    };
    if (connection.lifecycleStatus === 'error') {
      logger().warn(logContext, 'linear webhook: connection in error state, dropping');
    } else {
      logger().info(logContext, 'linear webhook: connection disabled, dropping');
    }
    await recordDeliveryOnly(params);
    return {outcome: 'inactive-connection'};
  }

  const supported = linearWebhookEnvelopeSchema.safeParse(params.payload);
  if (!supported.success) {
    logger().info(
      {
        deliveryId: params.deliveryId,
        organizationId: params.payload.organizationId,
        type: params.payload.type,
        action: params.payload.action,
      },
      'linear webhook: unsupported event, dropping',
    );
    await recordDeliveryOnly(params);
    return {outcome: 'unsupported-event'};
  }

  if (supported.data.type === 'AgentSessionEvent' && supported.data.action === 'created') {
    // Linear gives a session 10 seconds to show an activity, which can't wait for the outbox.
    startAgentSessionAcknowledgement({
      acknowledge: params.acknowledgeAgentSession,
      connectionId: connection.id,
      agentSessionId: supported.data.agentSession.id,
      deliveryId: params.deliveryId,
    });
  }

  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: LINEAR_PROVIDER,
      source: connection.slug,
      event: linearWebhookEventName(supported.data),
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: params.rawPayload,
    },
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

function startAgentSessionAcknowledgement(input: {
  acknowledge: AcknowledgeLinearAgentSession | undefined;
  connectionId: string;
  agentSessionId: unknown;
  deliveryId: string;
}): void {
  if (!input.acknowledge || typeof input.agentSessionId !== 'string') return;
  const {connectionId, agentSessionId, deliveryId} = input;
  input
    .acknowledge({connectionId, agentSessionId})
    .catch((err: unknown) =>
      logger().warn(
        {deliveryId, connectionId, agentSessionId, err},
        'linear webhook: agent session acknowledgement failed',
      ),
    );
}

function linearWebhookEventName(payload: LinearWebhookEnvelopeDto): LinearWebhookEventName {
  if (payload.type === 'AgentSessionEvent') return `agentSession.${payload.action}`;
  return `${payload.type}.${payload.action}`;
}

async function recordDeliveryOnly(params: {
  tx: IntegrationTx;
  deliveryId: string;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
}): Promise<void> {
  await params.recordDeliveryOnly({
    tx: params.tx,
    provider: LINEAR_PROVIDER,
    deliveryId: params.deliveryId,
  });
}
