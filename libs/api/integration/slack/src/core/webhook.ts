import {
  SLACK_APP_UNINSTALLED_EVENT,
  SLACK_PROVIDER,
  SLACK_SLASH_COMMAND_EVENT,
  type SlackEventBaseEnvelopeDto,
  type SlackLifecycleEventType,
  type SlackSlashCommandDto,
  slackEventEnvelopeSchema,
  slackLifecycleEventTypes,
  slackTokensRevokedEventSchema,
} from '@shipfox/api-integration-slack-dto';
import type {
  ClaimWebhookDeliveryFn,
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {
  getSlackInstallationByTeamId,
  markSlackInstallationRevoked,
  type SlackInstallation,
} from '#db/installations.js';

const slackSelfAuthoredEventSchema = z
  .object({
    bot_id: z.string().optional(),
    user: z.string().optional(),
    message: z
      .object({
        bot_id: z.string().optional(),
        user: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SlackWebhookOutcome =
  | 'published'
  | 'duplicate'
  | 'unknown-team'
  | 'revoked-installation'
  | 'revoked'
  | 'unaffected-revocation'
  | 'stale-lifecycle-event'
  | 'missing-connection'
  | 'inactive-connection'
  | 'unsupported-event'
  | 'self-message';

interface SlackWebhookParams {
  tx: IntegrationTx;
  deliveryId: string;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export interface HandleSlackEventParams extends SlackWebhookParams {
  envelope: SlackEventBaseEnvelopeDto;
  claimWebhookDelivery: ClaimWebhookDeliveryFn;
}

export interface HandleSlackCommandParams extends SlackWebhookParams {
  command: SlackSlashCommandDto;
}

type SlackConnectionResolution =
  | {kind: 'ok'; connection: IntegrationConnection; installation: SlackInstallation}
  | {
      kind: 'drop';
      outcome: SlackConnectionDropOutcome;
    };

type SlackCommandOutcome = Exclude<
  SlackWebhookOutcome,
  | 'unsupported-event'
  | 'self-message'
  | 'revoked'
  | 'unaffected-revocation'
  | 'stale-lifecycle-event'
>;
type SlackConnectionDropOutcome = Exclude<SlackCommandOutcome, 'published' | 'duplicate'>;

export async function handleSlackEvent(
  params: HandleSlackEventParams,
): Promise<{outcome: SlackWebhookOutcome}> {
  const lifecycleType = asSlackLifecycleEventType(params.envelope.event.type);
  if (lifecycleType) return handleSlackLifecycleEvent(params, lifecycleType);

  const resolution = await resolveSlackConnection({
    ...params,
    teamId: params.envelope.team_id,
  });
  if (resolution.kind === 'drop') return resolution;

  if (isSelfAuthoredSlackEvent(params.envelope.event, resolution.installation.botUserId)) {
    await recordSlackDeliveryOnly(params);
    return {outcome: 'self-message'};
  }

  const supported = slackEventEnvelopeSchema.safeParse(params.envelope);
  if (!supported.success) {
    logger().info(
      {
        deliveryId: params.deliveryId,
        teamId: params.envelope.team_id,
        type: params.envelope.event.type,
      },
      'slack webhook: unsupported event, dropping',
    );
    await recordSlackDeliveryOnly(params);
    return {outcome: 'unsupported-event'};
  }

  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: SLACK_PROVIDER,
      source: resolution.connection.slug,
      event: supported.data.event.type,
      workspaceId: resolution.connection.workspaceId,
      connectionId: resolution.connection.id,
      connectionName: resolution.connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: {
        ...supported.data.event,
        team_id: supported.data.team_id,
        api_app_id: supported.data.api_app_id,
        event_id: supported.data.event_id,
        event_time: supported.data.event_time,
      },
    },
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

export async function handleSlackCommand(
  params: HandleSlackCommandParams,
): Promise<{outcome: SlackCommandOutcome}> {
  const resolution = await resolveSlackConnection({
    ...params,
    teamId: params.command.team_id,
  });
  if (resolution.kind === 'drop') return resolution;

  const {token: _token, ...payload} = params.command;
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: SLACK_PROVIDER,
      source: resolution.connection.slug,
      event: SLACK_SLASH_COMMAND_EVENT,
      workspaceId: resolution.connection.workspaceId,
      connectionId: resolution.connection.id,
      connectionName: resolution.connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload,
    },
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

export function isSelfAuthoredSlackEvent(event: unknown, botUserId: string): boolean {
  const parsed = slackSelfAuthoredEventSchema.safeParse(event);
  if (!parsed.success) return false;
  const nestedMessage = parsed.data.message;
  return (
    parsed.data.bot_id !== undefined ||
    parsed.data.user === botUserId ||
    nestedMessage?.bot_id !== undefined ||
    nestedMessage?.user === botUserId
  );
}

function asSlackLifecycleEventType(eventType: string): SlackLifecycleEventType | undefined {
  return slackLifecycleEventTypes.find((type) => type === eventType);
}

async function handleSlackLifecycleEvent(
  params: HandleSlackEventParams,
  lifecycleType: SlackLifecycleEventType,
): Promise<{outcome: SlackWebhookOutcome}> {
  const claim = await params.claimWebhookDelivery({
    tx: params.tx,
    provider: SLACK_PROVIDER,
    deliveryId: params.deliveryId,
  });
  if (!claim.claimed) {
    logger().info(
      {deliveryId: params.deliveryId, teamId: params.envelope.team_id, lifecycleType},
      'slack lifecycle event: duplicate delivery, dropping',
    );
    return {outcome: 'duplicate'};
  }

  const installation = await getSlackInstallationByTeamId(params.envelope.team_id, {tx: params.tx});
  if (!installation) {
    logger().warn(
      {deliveryId: params.deliveryId, teamId: params.envelope.team_id, lifecycleType},
      'slack lifecycle event: unknown team, dropping',
    );
    return {outcome: 'unknown-team'};
  }

  if (installation.status !== 'installed') {
    logger().info(
      {
        deliveryId: params.deliveryId,
        teamId: params.envelope.team_id,
        connectionId: installation.connectionId,
        lifecycleType,
      },
      'slack lifecycle event: installation is not installed, dropping',
    );
    return {outcome: 'revoked-installation'};
  }

  if (
    isSlackLifecycleEventOlderThanInstallation(params.envelope.event_time, installation.updatedAt)
  ) {
    logger().info(
      {
        deliveryId: params.deliveryId,
        teamId: params.envelope.team_id,
        connectionId: installation.connectionId,
      },
      'slack lifecycle event: predates the current installation, dropping',
    );
    return {outcome: 'stale-lifecycle-event'};
  }

  const revokesInstallation =
    lifecycleType === SLACK_APP_UNINSTALLED_EVENT ||
    slackTokensRevokedAffectsBot(params.envelope.event, installation.botUserId);
  if (!revokesInstallation) {
    logger().info(
      {
        deliveryId: params.deliveryId,
        teamId: params.envelope.team_id,
        connectionId: installation.connectionId,
      },
      'slack lifecycle event: token revocation does not affect installation bot, dropping',
    );
    return {outcome: 'unaffected-revocation'};
  }

  const revoked = await markSlackInstallationRevoked(installation.connectionId, {
    tx: params.tx,
    expectedGeneration: installation.generation,
  });
  if (!revoked) {
    logger().info(
      {
        deliveryId: params.deliveryId,
        teamId: params.envelope.team_id,
        connectionId: installation.connectionId,
      },
      'slack lifecycle event: installation changed before revocation, dropping',
    );
    return {outcome: 'stale-lifecycle-event'};
  }

  logger().info(
    {
      deliveryId: params.deliveryId,
      teamId: params.envelope.team_id,
      connectionId: installation.connectionId,
      lifecycleType,
    },
    'slack lifecycle event: installation revoked',
  );
  return {outcome: 'revoked'};
}

function slackTokensRevokedAffectsBot(event: unknown, botUserId: string): boolean {
  const parsed = slackTokensRevokedEventSchema.safeParse(event);
  // Only a named bot token proves this installation credential was revoked; OAuth-only and missing lists do not.
  return parsed.success && (parsed.data.tokens?.bot?.includes(botUserId) ?? false);
}

function isSlackLifecycleEventOlderThanInstallation(
  eventTime: number,
  installationUpdatedAt: Date,
): boolean {
  // Slack event_time has second precision, so an event stamped in the installation second is not provably stale.
  return eventTime < Math.floor(installationUpdatedAt.getTime() / 1000);
}

async function resolveSlackConnection(
  params: SlackWebhookParams & {teamId: string},
): Promise<SlackConnectionResolution> {
  const installation = await getSlackInstallationByTeamId(params.teamId, {tx: params.tx});
  if (!installation) {
    logger().warn(
      {deliveryId: params.deliveryId, teamId: params.teamId},
      'slack webhook: unknown team, dropping',
    );
    await recordSlackDeliveryOnly(params);
    return {kind: 'drop', outcome: 'unknown-team'};
  }

  if (installation.status !== 'installed') {
    logger().info(
      {
        deliveryId: params.deliveryId,
        teamId: params.teamId,
        connectionId: installation.connectionId,
      },
      'slack webhook: installation is not installed, dropping',
    );
    await recordSlackDeliveryOnly(params);
    return {kind: 'drop', outcome: 'revoked-installation'};
  }

  const connection = await params.getIntegrationConnectionById(installation.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    logger().warn(
      {
        deliveryId: params.deliveryId,
        teamId: params.teamId,
        connectionId: installation.connectionId,
      },
      'slack webhook: installation has no connection, dropping',
    );
    await recordSlackDeliveryOnly(params);
    return {kind: 'drop', outcome: 'missing-connection'};
  }

  if (connection.lifecycleStatus !== 'active') {
    logger().info(
      {deliveryId: params.deliveryId, teamId: params.teamId, connectionId: connection.id},
      'slack webhook: inactive connection, dropping',
    );
    await recordSlackDeliveryOnly(params);
    return {kind: 'drop', outcome: 'inactive-connection'};
  }

  return {kind: 'ok', connection, installation};
}

async function recordSlackDeliveryOnly(
  params: Pick<SlackWebhookParams, 'tx' | 'deliveryId' | 'recordDeliveryOnly'>,
): Promise<void> {
  await params.recordDeliveryOnly({
    tx: params.tx,
    provider: SLACK_PROVIDER,
    deliveryId: params.deliveryId,
  });
}
