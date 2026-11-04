import {listConversationsToRecover} from '#db/turn-runtime.js';
import {type RunDeliveryWorkflows, recoverRunResultDeliveries} from './deliver-run-results.js';

/** Conversations one sweep wakes. A larger backlog drains over the next firings. */
export const RECOVER_CONVERSATIONS_BATCH_LIMIT = 200;

/**
 * Wakes every conversation with a queued input or a requested retry and no running turn. A wake
 * is lost when Temporal is down or a signal fails, and the outbox can't cover it, so this sweep
 * is the durable path. Work always clears: a turn claims its inputs even when it fails, and a
 * refused turn settles them, so a conversation the sweep wakes does not stay on its list.
 *
 * It first runs the run-result checks that events left requested for over a minute, because a
 * finished run emits no more events and the outbox can't retry them. A result they queue wakes
 * its conversation on the spot, and the listing after them finds any wake that failed.
 */
export async function recoverConversations(params: {
  wake: (conversationId: string) => Promise<void>;
  workflows?: RunDeliveryWorkflows | undefined;
  limit?: number | undefined;
}): Promise<{woken: number; checked: number}> {
  const {checked} =
    params.workflows === undefined
      ? {checked: 0}
      : await recoverRunResultDeliveries({workflows: params.workflows, wake: params.wake});
  const conversationIds = await listConversationsToRecover(
    params.limit ?? RECOVER_CONVERSATIONS_BATCH_LIMIT,
  );
  for (const conversationId of conversationIds) {
    await params.wake(conversationId);
  }
  return {woken: conversationIds.length, checked};
}
