import {
  type LinearIssueFixtureData,
  postLinearAgentSession,
  postLinearIssueUpdate,
} from '@shipfox/e2e-driver-linear';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {z} from 'zod';
import {deliverUntilRun, describeDecisions, type RunLookup} from './deliveries.js';
import {formatValidationIssues, type LinearIssueSeed} from './schema.js';
import type {EventSender} from './senders.js';

const STATE_ID = 'eval-state-todo';

const agentSessionSchema = z.object({issue: z.string().min(1)}).strict();

const issueUpdateSchema = z
  .object({issue: z.string().min(1), added_label: z.string().min(1)})
  .strict();

/** What the sender uses to post and follow a delivery. Tests replace it. */
export interface LinearDelivery extends RunLookup {
  postAgentSession: typeof postLinearAgentSession;
  postIssueUpdate: typeof postLinearIssueUpdate;
}

const defaultDelivery: LinearDelivery = {
  postAgentSession: postLinearAgentSession,
  postIssueUpdate: postLinearIssueUpdate,
  waitForRun: waitForRunByDeliveryId,
  describeDecisions,
};

export interface LinearSenderOptions {
  /** The organization of the case's Linear connection. */
  organizationId: string;
  appUserId: string;
  issues: readonly LinearIssueSeed[];
  delivery?: LinearDelivery | undefined;
}

function parsePayload<T>({
  schema,
  event,
  payload,
}: {
  schema: z.ZodType<T>;
  event: string;
  payload: unknown;
}): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `The linear ${event} payload is invalid:\n${formatValidationIssues(result.error)}`,
    );
  }
  return result.data;
}

const teamIdOf = (team: string) => `eval-team-${team.toLowerCase()}`;
const labelIdOf = (name: string) => `eval-label-${name.toLowerCase()}`;

function fixtureOf({
  issue,
  labels,
}: {
  issue: LinearIssueSeed;
  labels: readonly string[];
}): LinearIssueFixtureData {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    teamId: teamIdOf(issue.team),
    stateId: STATE_ID,
    teamKey: issue.team,
    description: issue.description,
    labels: labels.map((name) => ({id: labelIdOf(name), name})),
  };
}

function findIssue({
  issues,
  identifier,
}: {
  issues: readonly LinearIssueSeed[];
  identifier: string;
}): LinearIssueSeed {
  const issue = issues.find((candidate) => candidate.identifier === identifier);
  if (issue === undefined) {
    throw new Error(
      `The case seeds no Linear issue ${identifier}. It seeds: ${issues.map((candidate) => candidate.identifier).join(', ')}.`,
    );
  }
  return issue;
}

/**
 * Delivers a scenario's Linear events to the stack, signed the way Linear signs them. Every
 * Linear event a scenario sends is expected to start a run, because the triggers are the only
 * Linear subscribers a case defines.
 */
export function createLinearEventSender(options: LinearSenderOptions): EventSender {
  const delivery = options.delivery ?? defaultDelivery;
  return async ({event, payload, context, signal}) => {
    switch (event) {
      case 'agentSession.created': {
        const session = parsePayload({schema: agentSessionSchema, event, payload});
        const issue = findIssue({issues: options.issues, identifier: session.issue});
        return await deliverUntilRun({
          provider: 'Linear',
          context,
          signal,
          delivery,
          post: async () =>
            await delivery.postAgentSession({
              action: 'created',
              organizationId: options.organizationId,
              appUserId: options.appUserId,
              sessionId: crypto.randomUUID(),
              issue: fixtureOf({issue, labels: issue.labels}),
            }),
        });
      }
      case 'Issue.update': {
        const update = parsePayload({schema: issueUpdateSchema, event, payload});
        const issue = findIssue({issues: options.issues, identifier: update.issue});
        const labels = [...new Set([...issue.labels, update.added_label])];
        return await deliverUntilRun({
          provider: 'Linear',
          context,
          signal,
          delivery,
          post: async () =>
            await delivery.postIssueUpdate({
              organizationId: options.organizationId,
              issue: fixtureOf({issue, labels}),
              previousStateId: STATE_ID,
              previousLabelIds: issue.labels.map(labelIdOf),
              actorId: `${options.appUserId}-actor`,
            }),
        });
      }
      default:
        throw new Error(`The Linear driver cannot send ${event} events.`);
    }
  };
}
