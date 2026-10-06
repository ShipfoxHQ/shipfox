import type {RecordedWrite} from '@shipfox/e2e-core';
import {
  type JiraApiMock,
  type JiraIssueEventName,
  postJiraIssueEvent,
  startJiraApiMock,
} from '@shipfox/e2e-driver-jira';
import {createJiraConnection} from '@shipfox/e2e-setup-integrations';
import {z} from 'zod';
import {formatValidationIssues} from './schema.js';
import type {EventSender} from './senders.js';

const JIRA_EVENTS: readonly JiraIssueEventName[] = ['jira:issue_created', 'jira:issue_updated'];

const issueSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z0-9_]+-[0-9]+$/u, {message: 'must look like ENG-7'}),
    // Jira gives an issue an ID apart from its key, and the templates pass the ID to the tools.
    id: z.string().min(1).optional(),
    summary: z.string().min(1),
    description: z.string().optional(),
    status: z.string().min(1).default('To Do'),
    project: z.string().min(1).optional(),
    labels: z.array(z.string().min(1)).optional(),
  })
  .strict();

const issueEventSchema = z
  .object({
    issue: issueSchema,
    previous_status: z.string().min(1).optional(),
    previous_labels: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** The `jira.` prefix keeps a Jira write apart from a GitHub write of the same kind. */
export function prefixJiraWrites(writes: readonly RecordedWrite[]): RecordedWrite[] {
  return writes.map((write) => ({...write, kind: `jira.${write.kind}`}));
}

export interface JiraTracker {
  /** The slug the composed workflow's tracker connection uses. */
  connectionSlug: string;
  sender: EventSender;
  /** The fake, for suites that seed it. */
  mock: JiraApiMock;
  /** Every write the Jira fake accepted, as `jira.<kind>` entries. Read before it stops. */
  writes: () => RecordedWrite[];
}

/**
 * The Jira fake and a Jira connection in the case's workspace, with a sender that delivers signed
 * issue events for it. The connection accepts deliveries for one synthetic webhook.
 */
export async function arrangeJiraTracker({
  workspaceId,
  uniqueId,
  cleanups,
}: {
  workspaceId: string;
  uniqueId: string;
  cleanups: Array<() => Promise<void>>;
}): Promise<JiraTracker> {
  const accessToken = `jira-access-token-${uniqueId}`;
  const mock = await startJiraApiMock({accessToken});
  cleanups.push(() => mock.stop());

  const siteUrl = `https://eval-${uniqueId}.atlassian.example.test`;
  const webhookId = Number.parseInt(uniqueId.slice(0, 6), 16) + 1;
  const connection = await createJiraConnection({
    workspaceId,
    cloudId: `eval-cloud-${uniqueId}`,
    siteUrl,
    siteName: `Eval Jira ${uniqueId}`,
    authorizingAccountId: `eval-account-${uniqueId}`,
    displayName: `Eval Jira ${uniqueId}`,
    accessToken,
    webhookIds: [webhookId],
  });
  return {
    connectionSlug: connection.slug,
    mock,
    sender: createJiraEventSender({connectionId: connection.id, webhookId, siteUrl}),
    writes: () => prefixJiraWrites(mock.writes()),
  };
}

/**
 * Delivers a scenario's Jira issue events, signed the way Jira signs them. The issue ID defaults
 * to one made from the key, and the project to the key's prefix.
 */
export function createJiraEventSender({
  connectionId,
  webhookId,
  siteUrl,
  post = postJiraIssueEvent,
}: {
  connectionId: string;
  webhookId: number;
  siteUrl: string;
  /** Replaces the signed delivery, which tests don't have a stack for. */
  post?: typeof postJiraIssueEvent;
}): EventSender {
  return async ({event, payload}) => {
    if (!JIRA_EVENTS.includes(event as JiraIssueEventName)) {
      throw new Error(
        `The Jira sender cannot send ${event} events. Use ${JIRA_EVENTS.join(' or ')}.`,
      );
    }
    const parsed = issueEventSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `The jira ${event} payload is invalid:\n${formatValidationIssues(parsed.error)}`,
      );
    }
    const {
      issue,
      previous_status: previousStatusName,
      previous_labels: previousLabels,
    } = parsed.data;
    const deliveryId = await post({
      event: event as JiraIssueEventName,
      connectionId,
      webhookId,
      actorAccountId: 'eval-jira-user',
      previousStatusName,
      previousLabels,
      issue: {
        id: issue.id ?? `1${issue.key.replace(/\D/gu, '').padStart(4, '0')}`,
        key: issue.key,
        summary: issue.summary,
        statusName: issue.status,
        projectKey: issue.project ?? issue.key.split('-')[0],
        labels: issue.labels,
        description: issue.description,
        siteUrl,
      },
    });
    return {deliveryId};
  };
}
