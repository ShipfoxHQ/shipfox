import {
  buildTaskStatusUpdatedEnvelope,
  buildTaskTagUpdatedEnvelope,
  postClickUpDelivery,
} from '@shipfox/e2e-driver-clickup';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {z} from 'zod';
import {deliverUntilRun, describeDecisions, type RunLookup} from './deliveries.js';
import {type ClickUpTaskSeed, formatValidationIssues} from './schema.js';
import type {EventSender} from './senders.js';

// ClickUp names a task's status in lowercase, and tasks start in the first one.
const PREVIOUS_STATUS = 'to do';

const tagUpdatedSchema = z.object({task: z.string().min(1), tag: z.string().min(1)}).strict();

const statusUpdatedSchema = z.object({task: z.string().min(1), status: z.string().min(1)}).strict();

type ClickUpEnvelope = Parameters<typeof postClickUpDelivery>[0]['envelope'];

/** What the sender uses to post and follow a delivery. Tests replace it. */
export interface ClickUpDelivery extends RunLookup {
  post: typeof postClickUpDelivery;
}

const defaultDelivery: ClickUpDelivery = {
  post: postClickUpDelivery,
  waitForRun: waitForRunByDeliveryId,
  describeDecisions,
};

export interface ClickUpSenderOptions {
  connectionId: string;
  webhookId: string;
  webhookSecret: string;
  /** The user who authorized the connection. */
  actorId: string;
  tasks: readonly ClickUpTaskSeed[];
  delivery?: ClickUpDelivery | undefined;
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
      `The clickup ${event} payload is invalid:\n${formatValidationIssues(result.error)}`,
    );
  }
  return result.data;
}

function findTask({tasks, id}: {tasks: readonly ClickUpTaskSeed[]; id: string}): ClickUpTaskSeed {
  const task = tasks.find((candidate) => candidate.id === id);
  if (task === undefined) {
    throw new Error(
      `The case seeds no ClickUp task ${id}. It seeds: ${tasks.map((candidate) => candidate.id).join(', ')}.`,
    );
  }
  return task;
}

/**
 * Delivers a scenario's ClickUp events to the stack, signed the way ClickUp signs them. Every
 * ClickUp event a scenario sends is expected to start a run, because the triggers are the only
 * ClickUp subscribers a case defines.
 */
export function createClickUpEventSender(options: ClickUpSenderOptions): EventSender {
  const delivery = options.delivery ?? defaultDelivery;
  const changeOf = (task: ClickUpTaskSeed) => ({
    webhookId: options.webhookId,
    taskId: task.id,
    actorId: options.actorId,
    listId: task.list,
    // A new history item is a new delivery, so a repeated post is never dropped as a duplicate.
    historyItemId: `history-${crypto.randomUUID().replaceAll('-', '')}`,
  });
  return async ({event, payload, context, signal}) => {
    const deliver = async (envelopeFor: (task: ClickUpTaskSeed) => ClickUpEnvelope, id: string) => {
      const task = findTask({tasks: options.tasks, id});
      return await deliverUntilRun({
        provider: 'ClickUp',
        context,
        signal,
        delivery,
        post: async () =>
          await delivery.post({
            envelope: envelopeFor(task),
            webhookSecret: options.webhookSecret,
            connectionId: options.connectionId,
          }),
      });
    };
    switch (event) {
      case 'taskTagUpdated': {
        const update = parsePayload({schema: tagUpdatedSchema, event, payload});
        return await deliver(
          (task) => buildTaskTagUpdatedEnvelope({...changeOf(task), tags: [update.tag]}),
          update.task,
        );
      }
      case 'taskStatusUpdated': {
        const update = parsePayload({schema: statusUpdatedSchema, event, payload});
        return await deliver(
          (task) =>
            buildTaskStatusUpdatedEnvelope({
              ...changeOf(task),
              status: update.status,
              previousStatus: PREVIOUS_STATUS,
            }),
          update.task,
        );
      }
      default:
        throw new Error(`The ClickUp driver cannot send ${event} events.`);
    }
  };
}
