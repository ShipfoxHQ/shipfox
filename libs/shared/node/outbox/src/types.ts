/**
 * Map from event type string to its payload shape.
 * Each DTO package defines its own map fragment:
 *
 * @example
 * interface DefinitionsEventMap {
 *   [DEFINITION_RESOLVED]: DefinitionResolvedEvent;
 *   [DEFINITION_INVALID]: DefinitionInvalidEvent;
 * }
 */
export type EventType<TMap extends EventMapLike> = keyof TMap & string;

export type EventPayload<TMap extends EventMapLike, T extends EventType<TMap>> = TMap[T];

export interface DomainEvent<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  createdAt: Date;
}

export interface IdempotentOutboxEvent<TPayload = unknown> {
  idempotencyKey: string;
  type: string;
  orderingKey?: string;
  payload: TPayload;
  createdAt?: Date;
  availableAt?: Date;
}

export interface ClaimedOutboxEvent<TPayload = unknown> {
  id: string;
  idempotencyKey: string;
  type: string;
  orderingKey: string | null;
  payload: TPayload;
  createdAt: Date;
  attempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
}

export interface OutboxClaimReference {
  id: string;
  leaseToken: string;
}

export interface OutboxHealth {
  status: 'ready';
  checkedAt: Date;
  pendingCount: number;
  oldestPendingAt?: Date;
  oldestPendingAgeMs?: number;
}

export type OutboxAcknowledgeResult = {status: 'acknowledged'} | {status: 'stale'};

export type OutboxRetryResult =
  | {status: 'retry-scheduled'; nextAttemptAt: Date}
  | {status: 'dead-lettered'}
  | {status: 'stale'};

export type OutboxWriteResult = {status: 'created' | 'duplicate'};

// biome-ignore lint/suspicious/noExplicitAny: generic constraint for event maps
export type EventMapLike = Record<string, any>;
