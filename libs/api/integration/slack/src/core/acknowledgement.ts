import {logger} from '@shipfox/node-opentelemetry';
import {
  isFromAnotherTeam,
  isFromBot,
  PERSON_MESSAGE_SUBTYPES,
  slackInteractionPayloadSchema,
} from '#core/interaction-provider.js';
import {addSlackReaction, type SlackMessaging, setSlackSessionStatus} from '#core/replies.js';

const ACKNOWLEDGEMENT_REACTION = 'eyes';

export type AcknowledgeSlackEvent = (input: {
  connectionId: string;
  teamId: string;
  event: unknown;
}) => Promise<void>;

/**
 * Shows that a request arrived before routing runs: a reaction on a channel mention, and the
 * loading status on an agent view message. Thread replies get nothing, because only the owner
 * of a thread answers and routing hasn't picked one yet.
 */
export function createSlackEventAcknowledger(messaging: SlackMessaging): AcknowledgeSlackEvent {
  return async ({connectionId, teamId, event}) => {
    const parsed = slackInteractionPayloadSchema.safeParse(event);
    if (!parsed.success) return;
    const message = parsed.data;
    if (isFromBot(message) || isFromAnotherTeam(message, teamId)) return;
    if (!message.channel || !message.ts) return;

    if (message.type === 'app_mention') {
      await addSlackReaction(messaging, {
        connectionId,
        channel: message.channel,
        timestamp: message.ts,
        name: ACKNOWLEDGEMENT_REACTION,
      });
      return;
    }
    if (
      message.type === 'message' &&
      message.channel_type === 'im' &&
      PERSON_MESSAGE_SUBTYPES.has(message.subtype)
    ) {
      await setSlackSessionStatus(messaging, {
        connectionId,
        channel: message.channel,
        threadTs: message.thread_ts ?? message.ts,
        status: 'processing',
      });
    }
  };
}

export function startSlackAcknowledgement(input: {
  acknowledge: AcknowledgeSlackEvent | undefined;
  connectionId: string;
  teamId: string;
  event: unknown;
  deliveryId: string;
}): void {
  if (!input.acknowledge) return;
  const {connectionId, teamId, event, deliveryId} = input;
  input
    .acknowledge({connectionId, teamId, event})
    .catch((err: unknown) =>
      logger().warn({deliveryId, connectionId, err}, 'slack webhook: acknowledgement failed'),
    );
}
