import {createHmac, randomUUID} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

export type JiraIssueEventName = 'jira:issue_created' | 'jira:issue_updated';

export interface JiraIssueFixtureData {
  id: string;
  key: string;
  summary: string;
  statusName: string;
}

export interface JiraIssueEventParams {
  event: JiraIssueEventName;
  issue: JiraIssueFixtureData;
  /** The webhook ID the connection was created with, as `webhookIds` in the setup helper. */
  webhookId: number;
  actorAccountId: string;
  /** The status the issue moved from. Sent as a changelog item on `jira:issue_updated`. */
  previousStatusName?: string | undefined;
}

export function signJiraAuthorization(): string {
  const clientSecret = process.env.JIRA_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error('JIRA_OAUTH_CLIENT_SECRET must be configured for Jira event signing.');
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const signingInput = [
    {alg: 'HS256', typ: 'JWT'},
    {iss: 'atlassian', iat: issuedAt, exp: issuedAt + 3600},
  ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .join('.');
  const signature = createHmac('sha256', clientSecret).update(signingInput).digest('base64url');
  return `Bearer ${signingInput}.${signature}`;
}

export function buildJiraIssueEnvelope(params: JiraIssueEventParams) {
  const isUpdate = params.event === 'jira:issue_updated';
  return {
    webhookEvent: params.event,
    timestamp: Date.now(),
    issue_event_type_name: isUpdate ? 'issue_generic' : 'issue_created',
    user: {accountId: params.actorAccountId, displayName: 'E2E Jira User'},
    issue: {
      id: params.issue.id,
      key: params.issue.key,
      fields: {
        summary: params.issue.summary,
        status: {name: params.issue.statusName},
      },
    },
    ...(isUpdate && params.previousStatusName !== undefined
      ? {
          changelog: {
            id: randomUUID(),
            items: [
              {
                field: 'status',
                fieldtype: 'jira',
                fieldId: 'status',
                fromString: params.previousStatusName,
                toString: params.issue.statusName,
              },
            ],
          },
        }
      : {}),
    matchedWebhookIds: [params.webhookId],
  };
}

/**
 * Posts a signed Jira issue delivery for a connection and returns the delivery ID the API records
 * for it, for correlating a run when a matching trigger starts one.
 */
export async function postJiraIssueEvent(
  params: JiraIssueEventParams & {connectionId: string},
): Promise<string> {
  // Jira sends this header with a stable ID per delivery, and the API prefixes it with the connection.
  const identifier = randomUUID();
  const response = await fetch(
    new URL(`/webhooks/integrations/jira/${params.connectionId}`, config.API_URL),
    {
      method: 'POST',
      body: JSON.stringify(buildJiraIssueEnvelope(params)),
      headers: {
        authorization: signJiraAuthorization(),
        'content-type': 'application/json',
        'x-atlassian-webhook-identifier': identifier,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Signed Jira event delivery failed with ${response.status}.`);
  }
  return `${params.connectionId}:${identifier}`;
}
