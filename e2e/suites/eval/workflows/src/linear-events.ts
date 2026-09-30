import {createApiClient} from '@shipfox/e2e-core';
import {
  type LinearIssueFixtureData,
  postLinearAgentSession,
  postLinearIssueUpdate,
} from '@shipfox/e2e-driver-linear';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {z} from 'zod';
import {formatValidationIssues, type LinearIssueSeed} from './schema.js';
import type {EventSender} from './senders.js';

const MAX_DELIVERY_ATTEMPTS = 6;
const RUN_LOOKUP_TIMEOUT_MS = 5_000;
const STATE_ID = 'eval-state-todo';

const agentSessionSchema = z.object({issue: z.string().min(1)}).strict();

const issueUpdateSchema = z
  .object({issue: z.string().min(1), added_label: z.string().min(1)})
  .strict();

/** What the sender uses to post and follow a delivery. Tests replace it. */
export interface LinearDelivery {
  postAgentSession: typeof postLinearAgentSession;
  postIssueUpdate: typeof postLinearIssueUpdate;
  waitForRun: typeof waitForRunByDeliveryId;
  describeDecisions: typeof describeDecisions;
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

/** What the trigger decided about a delivery, so a run that never started can be explained. */
async function describeDecisions({
  deliveryId,
  context,
}: {
  deliveryId: string;
  context: Parameters<EventSender>[0]['context'];
}): Promise<string> {
  try {
    const client = createApiClient({token: context.token});
    const list = await client.requestJson<{
      trigger_events: Array<{id: string; delivery_id: string | null}>;
    }>(
      'get',
      `/trigger-events?${new URLSearchParams({workspace_id: context.workspaceId, limit: '100'})}`,
    );
    const event = list.trigger_events.find((candidate) => candidate.delivery_id === deliveryId);
    if (event === undefined) return `The API recorded no trigger event for delivery ${deliveryId}.`;
    const detail = await client.requestJson<{decisions: unknown[]}>(
      'get',
      `/trigger-events/${encodeURIComponent(event.id)}`,
    );
    return `Trigger decisions for delivery ${deliveryId}: ${JSON.stringify(detail.decisions)}`;
  } catch (error) {
    return `Could not read the trigger decisions: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * A delivery that lands before the definition's subscription is active starts no run. So the
 * sender posts again, with a new delivery, until one starts a run. It returns the delivery that
 * did.
 */
async function deliverUntilRun({
  post,
  delivery,
  context,
  signal,
}: {
  post: () => Promise<string>;
  delivery: Pick<LinearDelivery, 'waitForRun' | 'describeDecisions'>;
  context: Parameters<EventSender>[0]['context'];
  signal?: AbortSignal | undefined;
}): Promise<{deliveryId: string}> {
  let lastError: unknown;
  let lastDeliveryId = '';
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS && !signal?.aborted; attempt += 1) {
    const deliveryId = await post();
    lastDeliveryId = deliveryId;
    try {
      await delivery.waitForRun({
        deliveryId,
        projectId: context.projectId,
        workspaceId: context.workspaceId,
        token: context.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        ...(signal === undefined ? {} : {signal}),
      });
      return {deliveryId};
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `No run started from the signed Linear deliveries. ${await delivery.describeDecisions({deliveryId: lastDeliveryId, context})}`,
    {cause: lastError},
  );
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
