import {injectDiscordMessageCreate} from '@shipfox/e2e-driver-discord';
import {z} from 'zod';
import {formatValidationIssues} from './schema.js';
import type {EventSender} from './senders.js';

const messageCreateSchema = z
  .object({
    channel_id: z.string().min(1),
    id: z.string().min(1),
    user: z.string().min(1),
    content: z.string(),
  })
  .strict();

/**
 * Delivers a scenario's Discord events through the handler the Gateway service uses, for the
 * case's Discord connection. The message id is the delivery id, which is how a `start` step finds
 * the run the mention started.
 */
export function createDiscordEventSender({
  connectionId,
  injectMessage = injectDiscordMessageCreate,
}: {
  connectionId: string;
  /** Injects the dispatch. Tests replace it, because the real one calls the API. */
  injectMessage?: typeof injectDiscordMessageCreate;
}): EventSender {
  return async ({event, payload}) => {
    if (event !== 'message_create')
      throw new Error(`The Discord fake cannot send ${event} events.`);
    const result = messageCreateSchema.safeParse(payload);
    if (!result.success) {
      throw new Error(
        `The discord ${event} payload is invalid:\n${formatValidationIssues(result.error)}`,
      );
    }
    const {channel_id: channelId, id: messageId, user: authorId, content} = result.data;
    await injectMessage({connectionId, channelId, messageId, authorId, content});
    return {deliveryId: messageId};
  };
}
