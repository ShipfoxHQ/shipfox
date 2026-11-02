import type {
  Interaction,
  InteractionProvider,
  InteractionRole,
  ReportInteractionProgressInput,
  SendInteractionReplyInput,
} from '#contracts.js';

/** What the fake's `readInteraction` expects as an event payload. */
export interface FakeInteractionPayload {
  conversationKey: string;
  text?: string | undefined;
  context?: Record<string, unknown> | undefined;
  author?: Interaction['author'];
  /** Makes the fake treat the event as not meant for an agent. */
  ignored?: boolean | undefined;
}

export const FAKE_INTERACTION_EVENTS = {
  'fake.request': 'request',
  'fake.follow_up': 'follow_up',
  'fake.stop': 'stop',
} as const satisfies Record<string, InteractionRole>;

export interface FakeInteractionProviderOptions {
  /** Defaults to true. Without it the provider has no `reportProgress`, as some real ones won't. */
  reportsProgress?: boolean | undefined;
  /** Replies to these conversations come back undeliverable. */
  undeliverableConversationKeys?: readonly string[] | undefined;
}

export interface FakeInteractionProvider {
  provider: InteractionProvider;
  replies: SendInteractionReplyInput[];
  progress: ReportInteractionProgressInput[];
}

/** An interaction provider that records what it is asked to send, for tests. */
export function createFakeInteractionProvider(
  options: FakeInteractionProviderOptions = {},
): FakeInteractionProvider {
  const replies: SendInteractionReplyInput[] = [];
  const progress: ReportInteractionProgressInput[] = [];
  const undeliverable = new Set(options.undeliverableConversationKeys);

  const provider: InteractionProvider = {
    interactionEvents: FAKE_INTERACTION_EVENTS,
    requestContextSchema: {
      type: 'object',
      properties: {channel: {type: 'string'}},
    },
    replyGuidance: 'Answer in one short paragraph.',
    readInteraction: async ({event, payload}) => {
      await Promise.resolve();
      const role = (FAKE_INTERACTION_EVENTS as Record<string, InteractionRole>)[event];
      const fake = payload as FakeInteractionPayload;
      if (role === undefined || fake.ignored) return undefined;
      return {
        conversationKey: fake.conversationKey,
        role,
        context: fake.context ?? {},
        ...(fake.author === undefined ? {} : {author: fake.author}),
        text: fake.text ?? '',
      };
    },
    sendReply: async (input) => {
      await Promise.resolve();
      if (undeliverable.has(input.conversationKey)) {
        return {outcome: 'undeliverable', reason: 'The conversation was archived'};
      }
      replies.push(input);
      return {outcome: 'delivered'};
    },
    ...(options.reportsProgress === false
      ? {}
      : {
          reportProgress: async (input: ReportInteractionProgressInput) => {
            await Promise.resolve();
            progress.push(input);
          },
        }),
  };

  return {provider, replies, progress};
}
