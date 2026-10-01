import {createHmac, randomUUID} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

export type JiraIssueEventName = 'jira:issue_created' | 'jira:issue_updated';

export interface JiraIssueFixtureData {
  id: string;
  key: string;
  summary: string;
  statusName: string;
  /** The key of the project the issue belongs to, which triggers filter on. */
  projectKey?: string | undefined;
  labels?: string[] | undefined;
  description?: string | undefined;
  /** The site the issue lives on. Jira's `self` link is built from it. */
  siteUrl?: string | undefined;
}

export interface JiraIssueEventParams {
  event: JiraIssueEventName;
  issue: JiraIssueFixtureData;
  /** The webhook ID the connection was created with, as `webhookIds` in the setup helper. */
  webhookId: number;
  actorAccountId: string;
  /** The status the issue moved from. Sent as a changelog item on `jira:issue_updated`. */
  previousStatusName?: string | undefined;
  /** The labels the issue had before. Sent as a changelog item on `jira:issue_updated`. */
  previousLabels?: string[] | undefined;
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

function issueFields(issue: JiraIssueFixtureData) {
  return {
    summary: issue.summary,
    status: {name: issue.statusName},
    ...(issue.projectKey === undefined ? {} : {project: {key: issue.projectKey}}),
    ...(issue.labels === undefined ? {} : {labels: issue.labels}),
    ...(issue.description === undefined ? {} : {description: issue.description}),
  };
}

function changelogItems(params: JiraIssueEventParams) {
  const {issue, previousStatusName, previousLabels} = params;
  return [
    ...(previousStatusName === undefined
      ? []
      : [
          {
            field: 'status',
            fieldtype: 'jira',
            fieldId: 'status',
            fromString: previousStatusName,
            toString: issue.statusName,
          },
        ]),
    // Jira lists labels as one space-separated string.
    ...(previousLabels === undefined
      ? []
      : [
          {
            field: 'labels',
            fieldtype: 'jira',
            fieldId: 'labels',
            fromString: previousLabels.join(' '),
            toString: (issue.labels ?? []).join(' '),
          },
        ]),
  ];
}

export function buildJiraIssueEnvelope(params: JiraIssueEventParams) {
  const isUpdate = params.event === 'jira:issue_updated';
  const items = changelogItems(params);
  return {
    webhookEvent: params.event,
    timestamp: Date.now(),
    issue_event_type_name: isUpdate ? 'issue_generic' : 'issue_created',
    user: {accountId: params.actorAccountId, displayName: 'E2E Jira User'},
    issue: {
      id: params.issue.id,
      key: params.issue.key,
      ...(params.issue.siteUrl === undefined
        ? {}
        : {self: `${params.issue.siteUrl}/rest/api/3/issue/${params.issue.id}`}),
      fields: issueFields(params.issue),
    },
    ...(isUpdate && items.length > 0 ? {changelog: {id: randomUUID(), items}} : {}),
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
