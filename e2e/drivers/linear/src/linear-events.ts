import {createHmac, randomUUID} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

export interface LinearIssueFixtureData {
  id: string;
  identifier: string;
  title: string;
  teamId: string;
  stateId: string;
}

export interface LinearEventTarget {
  organizationId: string;
}

export function signLinearHeaders(params: {
  rawBody: string;
  deliveryId: string;
  event: string;
}): Record<string, string> {
  const signingSecret = process.env.LINEAR_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error('LINEAR_WEBHOOK_SIGNING_SECRET must be configured for Linear event signing.');
  }
  return {
    'linear-delivery': params.deliveryId,
    'linear-event': params.event,
    'linear-signature': createHmac('sha256', signingSecret).update(params.rawBody).digest('hex'),
  };
}

export function buildIssueUpdateEnvelope(
  params: LinearEventTarget & {
    issue: LinearIssueFixtureData;
    previousStateId: string;
    actorId: string;
  },
) {
  return {
    action: 'update' as const,
    type: 'Issue' as const,
    actor: {id: params.actorId, type: 'user', name: 'E2E Linear User'},
    createdAt: new Date().toISOString(),
    data: {
      id: params.issue.id,
      identifier: params.issue.identifier,
      title: params.issue.title,
      teamId: params.issue.teamId,
      stateId: params.issue.stateId,
    },
    updatedFrom: {stateId: params.previousStateId},
    url: `https://linear.app/e2e/issue/${params.issue.identifier}`,
    organizationId: params.organizationId,
    webhookTimestamp: Date.now(),
    webhookId: randomUUID(),
  };
}

export function buildAgentSessionEnvelope(
  params: LinearEventTarget & {
    action: 'created' | 'prompted';
    appUserId: string;
    sessionId: string;
    issue: LinearIssueFixtureData;
    /** The user's prompt. Linear sends it as an agent activity on `prompted` deliveries. */
    prompt?: string | undefined;
  },
) {
  const webhookId = randomUUID();
  return {
    action: params.action,
    type: 'AgentSessionEvent' as const,
    createdAt: new Date().toISOString(),
    organizationId: params.organizationId,
    oauthClientId: 'e2e-linear-client-id',
    appUserId: params.appUserId,
    agentSession: {
      id: params.sessionId,
      appUserId: params.appUserId,
      issueId: params.issue.id,
      issue: {
        id: params.issue.id,
        identifier: params.issue.identifier,
        title: params.issue.title,
        teamId: params.issue.teamId,
        url: `https://linear.app/e2e/issue/${params.issue.identifier}`,
      },
      status: 'pending',
    },
    ...(params.action === 'prompted' && params.prompt !== undefined
      ? {agentActivity: {id: randomUUID(), content: {type: 'prompt', body: params.prompt}}}
      : {}),
    promptContext: `<issue identifier="${params.issue.identifier}"><title>${params.issue.title}</title></issue>`,
    webhookTimestamp: Date.now(),
    webhookId,
  };
}

/** Posts a signed `Issue` update delivery and returns its delivery ID, the run's delivery ID. */
export async function postLinearIssueUpdate(
  params: Parameters<typeof buildIssueUpdateEnvelope>[0],
): Promise<string> {
  return await postSignedLinearEvent({
    event: 'Issue',
    rawBody: JSON.stringify(buildIssueUpdateEnvelope(params)),
  });
}

/** Posts a signed agent session delivery and returns its delivery ID, the run's delivery ID. */
export async function postLinearAgentSession(
  params: Parameters<typeof buildAgentSessionEnvelope>[0],
): Promise<string> {
  return await postSignedLinearEvent({
    event: 'AgentSessionEvent',
    rawBody: JSON.stringify(buildAgentSessionEnvelope(params)),
  });
}

async function postSignedLinearEvent(params: {event: string; rawBody: string}): Promise<string> {
  const deliveryId = randomUUID();
  const response = await fetch(new URL('/webhooks/integrations/linear', config.API_URL), {
    method: 'POST',
    body: params.rawBody,
    headers: {
      ...signLinearHeaders({rawBody: params.rawBody, deliveryId, event: params.event}),
      'content-type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Signed Linear event delivery failed with ${response.status}.`);
  }
  return deliveryId;
}
