import {postSlackAppMention} from '@shipfox/e2e-driver-slack';
import {z} from 'zod';
import {formatValidationIssues} from './schema.js';
import type {EventSender} from './senders.js';

const appMentionSchema = z
  .object({
    channel: z.string().min(1),
    ts: z.string().min(1),
    user: z.string().min(1),
    text: z.string(),
    // The parent message, when the mention is a reply in a thread.
    thread_ts: z.string().min(1).optional(),
  })
  .strict();

/**
 * Delivers a scenario's Slack events as signed webhooks for the case's Slack team. The delivery
 * id is the event id, which is how a `start` step finds the run the mention started.
 */
export function createSlackEventSender({
  teamId,
  postMention = postSlackAppMention,
}: {
  teamId: string;
  /** Posts the signed delivery. Tests replace it, because the real one calls the API. */
  postMention?: typeof postSlackAppMention;
}): EventSender {
  return async ({event, payload}) => {
    if (event !== 'app_mention') throw new Error(`The Slack fake cannot send ${event} events.`);
    const result = appMentionSchema.safeParse(payload);
    if (!result.success) {
      throw new Error(
        `The slack ${event} payload is invalid:\n${formatValidationIssues(result.error)}`,
      );
    }
    const {thread_ts: threadTs, ...mention} = result.data;
    return {deliveryId: await postMention({teamId, threadTs, ...mention})};
  };
}
