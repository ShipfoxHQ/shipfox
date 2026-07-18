import type {
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-core-dto';
import {
  SLACK_PROVIDER,
  SLACK_SLASH_COMMAND_EVENT,
  type SlackEventBaseEnvelopeDto,
  type SlackSlashCommandDto,
  slackEventEnvelopeSchema,
} from '@shipfox/api-integration-slack-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {getSlackInstallationByTeamId, type SlackInstallation} from '#db/installations.js';

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
}

export interface HandleSlackCommandParams extends SlackWebhookParams {
  command: SlackSlashCommandDto;
}

type SlackConnectionResolution =
  | {kind: 'ok'; connection: IntegrationConnection; installation: SlackInstallation}
  | {
      kind: 'drop';
      outcome: Exclude<
        SlackWebhookOutcome,
        'published' | 'duplicate' | 'unsupported-event' | 'self-message'
      >;
    };

export async function handleSlackEvent(
  params: HandleSlackEventParams,
): Promise<{outcome: SlackWebhookOutcome}> {
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
): Promise<{outcome: Exclude<SlackWebhookOutcome, 'unsupported-event' | 'self-message'>}> {
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
