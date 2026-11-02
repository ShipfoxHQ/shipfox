import {log, proxyActivities} from '@temporalio/workflow';
import type {ConversationActivities} from '../activities/conversation.js';

const {recoverConversations} = proxyActivities<ConversationActivities>({
  startToCloseTimeout: '2 minutes',
  // The next minute's firing is the retry, so a failed sweep must not hold this one open.
  retry: {maximumAttempts: 1},
});

/** Wakes the conversations a lost signal or a Temporal outage left with work. */
export async function recoverConversationsCron(): Promise<void> {
  const {woken} = await recoverConversations();
  if (woken > 0) log.info('Woke agent conversations with pending work', {woken});
}
