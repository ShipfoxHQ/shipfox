import type {WorkflowsEventMapDto} from '@shipfox/api-workflows-dto';
import {writeOutboxEvent, writeOutboxEvents} from '@shipfox/node-outbox';
import type {Tx} from './db.js';
import {workflowsOutbox} from './schema/outbox.js';

type WorkflowsOutboxEvent = {
  [K in keyof WorkflowsEventMapDto & string]: {
    type: K;
    payload: WorkflowsEventMapDto[K];
  };
}[keyof WorkflowsEventMapDto & string];

export async function writeWorkflowsOutboxEvent(
  tx: Tx,
  event: WorkflowsOutboxEvent,
): Promise<void> {
  await writeOutboxEvent<WorkflowsEventMapDto>(tx, workflowsOutbox, {
    ...event,
    orderingKey: workflowRunOrderingKey(event),
  });
}

export async function writeWorkflowsOutboxEvents(
  tx: Tx,
  events: WorkflowsOutboxEvent[],
): Promise<void> {
  await writeOutboxEvents<WorkflowsEventMapDto>(
    tx,
    workflowsOutbox,
    events.map((event) => ({
      ...event,
      orderingKey: workflowRunOrderingKey(event),
    })),
  );
}

function workflowRunOrderingKey(event: WorkflowsOutboxEvent): string | undefined {
  const workflowRunId = (event.payload as {workflowRunId?: unknown}).workflowRunId;
  return typeof workflowRunId === 'string' ? workflowRunId : undefined;
}
