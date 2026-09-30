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
}): Promise<string> {
  const eventId = `Ev${randomUUID().replaceAll('-', '')}`;
  const rawBody = JSON.stringify(buildAppMentionEnvelope({...params, eventId}));
  await postSignedSlackEvent(rawBody);
  return eventId;
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
