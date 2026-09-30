/** What a sender knows about the case it delivers an event for. */
export interface EventSenderContext {
  workspaceId: string;
  projectId: string;
  connectionId: string;
  /** The case user's session token. */
  token: string;
  /** The case repository, as `owner/name`. */
  repository: string;
}

/**
 * Delivers one provider event to the stack, signed the way the provider signs it. It returns the
 * delivery id when a `start` step needs to find the run the event started.
 */
export type EventSender = (params: {
  event: string;
  payload: Record<string, unknown>;
  context: EventSenderContext;
}) => Promise<{deliveryId?: string | undefined} | undefined>;

/** Senders by provider name, as written in a scenario's `send` and `start` steps. */
export type EventSenders = Record<string, EventSender>;
