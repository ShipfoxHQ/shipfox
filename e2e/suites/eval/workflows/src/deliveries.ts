import {createApiClient} from '@shipfox/e2e-core';
import type {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import type {EventSenderContext} from './senders.js';

const MAX_DELIVERY_ATTEMPTS = 6;
const RUN_LOOKUP_TIMEOUT_MS = 5_000;

/** What a sender uses to follow a delivery. Tests replace it. */
export interface RunLookup {
  waitForRun: typeof waitForRunByDeliveryId;
  describeDecisions: typeof describeDecisions;
}

/** What the trigger decided about a delivery, so a run that never started can be explained. */
export async function describeDecisions({
  deliveryId,
  context,
}: {
  deliveryId: string;
  context: EventSenderContext;
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
export async function deliverUntilRun({
  provider,
  post,
  delivery,
  context,
  signal,
}: {
  /** The provider's name, for the failure message. */
  provider: string;
  post: () => Promise<string>;
  delivery: RunLookup;
  context: EventSenderContext;
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
    `No run started from the signed ${provider} deliveries. ${await delivery.describeDecisions({deliveryId: lastDeliveryId, context})}`,
    {cause: lastError},
  );
}
