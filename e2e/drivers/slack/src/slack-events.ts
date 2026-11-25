import {createHmac, randomUUID} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

export function signSlackHeaders(rawBody: string): Record<string, string> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret)
    throw new Error('SLACK_SIGNING_SECRET must be configured for Slack event signing.');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  return {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${signature}`,
  };
}

export function buildAppMentionEnvelope(params: {
  teamId: string;
  channel: string;
  ts: string;
  user: string;
  text: string;
  /** The parent message's `ts`, for a mention made inside a thread. */
  threadTs?: string | undefined;
  eventId: string;
}) {
  return {
    type: 'event_callback' as const,
    team_id: params.teamId,
    api_app_id: 'A-e2e-slack',
    event: {
      type: 'app_mention' as const,
      channel: params.channel,
      ts: params.ts,
      user: params.user,
      text: params.text,
      ...(params.threadTs === undefined ? {} : {thread_ts: params.threadTs}),
    },
    event_id: params.eventId,
    event_time: Math.floor(Date.now() / 1000),
  };
}

/** A `message` event: a thread reply in a channel, a message to the app, or an app's own post. */
export function buildMessageEnvelope(params: {
  teamId: string;
  channel: string;
  /** `channel`, `group`, or `im`. The app's messages and the agent view are `im`. */
  channelType: string;
  ts: string;
  /** The parent message's `ts`, for a reply inside a thread. */
  threadTs?: string | undefined;
  user?: string | undefined;
  text: string;
  /** Set on a post made by an app, which agents ignore. */
  botId?: string | undefined;
  subtype?: string | undefined;
  /** The channel the person was viewing when they wrote to the agent view. */
  viewingChannelId?: string | undefined;
  eventId: string;
}) {
  return {
    type: 'event_callback' as const,
    team_id: params.teamId,
    api_app_id: 'A-e2e-slack',
    event: {
      type: 'message' as const,
      channel: params.channel,
      channel_type: params.channelType,
      ts: params.ts,
      text: params.text,
      ...(params.user === undefined ? {} : {user: params.user}),
      ...(params.threadTs === undefined ? {} : {thread_ts: params.threadTs}),
      ...(params.botId === undefined ? {} : {bot_id: params.botId}),
      ...(params.subtype === undefined ? {} : {subtype: params.subtype}),
      ...(params.viewingChannelId === undefined
        ? {}
        : {
            app_context: {
              context: {
                entities: [{type: 'slack#/types/channel_id', value: params.viewingChannelId}],
              },
            },
          }),
    },
    event_id: params.eventId,
    event_time: Math.floor(Date.now() / 1000),
  };
}

/** The agent view's stop control, which ends the reply in a session. */
export function buildAgentSessionStoppedEnvelope(params: {
  teamId: string;
  channel: string;
  threadTs: string;
  user?: string | undefined;
  eventId: string;
}) {
  return {
    type: 'event_callback' as const,
    team_id: params.teamId,
    api_app_id: 'A-e2e-slack',
    event: {
      type: 'agent_session_stopped' as const,
      channel: params.channel,
      channel_type: 'im',
      thread_ts: params.threadTs,
      ts: params.threadTs,
      ...(params.user === undefined ? {} : {user: params.user}),
    },
    event_id: params.eventId,
    event_time: Math.floor(Date.now() / 1000),
  };
}

/** Posts a signed `app_mention` delivery and returns its event ID, the run's delivery ID. */
export async function postSlackAppMention(params: {
  teamId: string;
  channel: string;
  ts: string;
  user: string;
  text: string;
  threadTs?: string | undefined;
}): Promise<string> {
  const eventId = newSlackEventId();
  const rawBody = JSON.stringify(buildAppMentionEnvelope({...params, eventId}));
  await postSignedSlackEvent(rawBody);
  return eventId;
}

/** Posts a signed `message` delivery and returns its event ID, the delivery ID. */
export async function postSlackMessage(
  params: Omit<Parameters<typeof buildMessageEnvelope>[0], 'eventId'>,
): Promise<string> {
  const eventId = newSlackEventId();
  await postSignedSlackEvent(JSON.stringify(buildMessageEnvelope({...params, eventId})));
  return eventId;
}

/** Posts a signed `agent_session_stopped` delivery and returns its event ID, the delivery ID. */
export async function postSlackAgentSessionStopped(
  params: Omit<Parameters<typeof buildAgentSessionStoppedEnvelope>[0], 'eventId'>,
): Promise<string> {
  const eventId = newSlackEventId();
  await postSignedSlackEvent(
    JSON.stringify(buildAgentSessionStoppedEnvelope({...params, eventId})),
  );
  return eventId;
}

function newSlackEventId(): string {
  return `Ev${randomUUID().replaceAll('-', '')}`;
}

async function postSignedSlackEvent(rawBody: string): Promise<void> {
  const response = await fetch(new URL('/webhooks/integrations/slack/events', config.API_URL), {
    method: 'POST',
    body: rawBody,
    headers: {
      ...signSlackHeaders(rawBody),
      'content-type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Signed Slack event delivery failed with ${response.status}.`);
  }
}
