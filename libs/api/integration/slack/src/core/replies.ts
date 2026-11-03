import type {
  InteractionReplyOutcome,
  ReportInteractionProgressInput,
  SendInteractionReplyInput,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {SlackApiClient, SlackWebApiResponse} from '#api/client.js';
import {isSlackAgentViewChannel, parseSlackConversationKey} from '#core/conversation-key.js';
import {
  SlackAccessTokenUnavailableError,
  SlackBotTokenMissingError,
  SlackConnectionNotFoundError,
  SlackIntegrationProviderError,
} from '#core/errors.js';
import {markdownMessage, splitMarkdownMessage} from '#core/markdown.js';
import type {SlackTokenStore} from '#core/tokens.js';

export interface SlackMessaging {
  slack: Pick<SlackApiClient, 'callMethod'>;
  tokenStore: Pick<SlackTokenStore, 'getAccessToken'>;
}

/** Errors a repeat can fix. Any other refusal, such as an archived channel or a removed app, is undeliverable. */
const TRANSIENT_ERRORS: ReadonlySet<string> = new Set([
  'ratelimited',
  'internal_error',
  'fatal_error',
  'request_timeout',
  'service_unavailable',
]);

export async function sendSlackReply(
  messaging: SlackMessaging,
  input: Pick<SendInteractionReplyInput, 'conversationKey' | 'text' | 'agent'>,
): Promise<InteractionReplyOutcome> {
  const conversation = parseSlackConversationKey(input.conversationKey);
  if (!conversation) return {outcome: 'undeliverable', reason: 'invalid-conversation-key'};

  const token = await readToken(messaging, conversation.connectionId);
  if (token.kind === 'unavailable') return {outcome: 'undeliverable', reason: token.reason};

  for (const part of splitMarkdownMessage(input.text)) {
    const body = await messaging.slack.callMethod({
      method: 'chat.postMessage',
      token: token.accessToken,
      arguments: {
        channel: conversation.channel,
        thread_ts: conversation.threadTs,
        username: input.agent.name,
        ...markdownMessage(part),
      },
    });
    const failure = readFailure(body);
    if (failure === undefined) continue;
    if (TRANSIENT_ERRORS.has(failure)) {
      throw new SlackIntegrationProviderError(
        failure === 'ratelimited' ? 'rate-limited' : 'provider-unavailable',
        `Slack could not post the reply: ${failure}`,
      );
    }
    return {outcome: 'undeliverable', reason: failure};
  }
  return {outcome: 'delivered'};
}

/**
 * Only the agent view shows a status. Slack shows its own loading state while `processing`, and a
 * session left there stays loading for up to an hour, so `idle` sets `active`. Progress is
 * cosmetic, so a failure is logged and never fails a turn.
 */
export async function reportSlackProgress(
  messaging: SlackMessaging,
  input: Pick<ReportInteractionProgressInput, 'conversationKey' | 'state'>,
): Promise<void> {
  const conversation = parseSlackConversationKey(input.conversationKey);
  if (!conversation || !isSlackAgentViewChannel(conversation.channel)) return;
  await setSlackSessionStatus(messaging, {
    connectionId: conversation.connectionId,
    channel: conversation.channel,
    threadTs: conversation.threadTs,
    status: input.state === 'working' ? 'processing' : 'active',
  });
}

export async function setSlackSessionStatus(
  messaging: SlackMessaging,
  input: {
    connectionId: string;
    channel: string;
    threadTs: string;
    status: 'processing' | 'active';
  },
): Promise<void> {
  try {
    const token = await readToken(messaging, input.connectionId);
    if (token.kind === 'unavailable') return;
    const body = await messaging.slack.callMethod({
      method: 'agents.sessions.setStatus',
      token: token.accessToken,
      arguments: {channel_id: input.channel, thread_ts: input.threadTs, status: input.status},
    });
    const failure = readFailure(body);
    if (failure !== undefined) {
      logger().warn(
        {connectionId: input.connectionId, channel: input.channel, status: input.status, failure},
        'slack agent view status was not set',
      );
    }
  } catch (err) {
    logger().warn(
      {connectionId: input.connectionId, channel: input.channel, status: input.status, err},
      'slack agent view status failed',
    );
  }
}

export async function addSlackReaction(
  messaging: SlackMessaging,
  input: {connectionId: string; channel: string; timestamp: string; name: string},
): Promise<void> {
  const token = await readToken(messaging, input.connectionId);
  if (token.kind === 'unavailable') return;
  const body = await messaging.slack.callMethod({
    method: 'reactions.add',
    token: token.accessToken,
    arguments: {channel: input.channel, timestamp: input.timestamp, name: input.name},
  });
  const failure = readFailure(body);
  // A repeated delivery finds the reaction already there.
  if (failure !== undefined && failure !== 'already_reacted') {
    logger().warn(
      {connectionId: input.connectionId, channel: input.channel, failure},
      'slack reaction was not added',
    );
  }
}

type TokenResult = {kind: 'ok'; accessToken: string} | {kind: 'unavailable'; reason: string};

async function readToken(messaging: SlackMessaging, connectionId: string): Promise<TokenResult> {
  try {
    return {
      kind: 'ok',
      accessToken: await messaging.tokenStore.getAccessToken({connectionId}),
    };
  } catch (error) {
    if (error instanceof SlackAccessTokenUnavailableError) {
      return {kind: 'unavailable', reason: `app-unavailable: ${error.reason}`};
    }
    if (
      error instanceof SlackConnectionNotFoundError ||
      error instanceof SlackBotTokenMissingError
    ) {
      return {kind: 'unavailable', reason: 'app-unavailable: connection-removed'};
    }
    throw error;
  }
}

function readFailure(body: SlackWebApiResponse): string | undefined {
  if (body.ok) return undefined;
  return typeof body.error === 'string' ? body.error : 'unknown_error';
}
