import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '#contracts/index.js';
import type {IntegrationEventReceivedEvent, SourcePushPayload} from '#events.js';

// The persistence seam between the integrations core and a provider package.
// `@shipfox/api-integration-core` implements these against its own tables and
// injects them into each provider at composition time, so providers depend only
// on this contract — never on core itself, which would create a dependency cycle
// (core composes the providers).

/**
 * Database/transaction handle threaded from core into a provider and back into
 * core-owned persistence. Typed loosely so providers don't take a Drizzle
 * dependency just to pass a transaction through; core supplies the concrete
 * executor and conformance is checked where it wires the providers.
 */
// biome-ignore lint/suspicious/noExplicitAny: cross-package tx handle, kept opaque to avoid a cyclic dep on core
export type IntegrationTx = any;

export type PublishIntegrationEventReceivedFn = (params: {
  tx: IntegrationTx;
  event: IntegrationEventReceivedEvent;
}) => Promise<{published: boolean}>;

// Emitted by source-control providers for a single push. Writes both the generic
// envelope (for triggers) and the typed source event (for domain consumers) under one
// delivery-dedup, so it must run inside a transaction — never a bare connection.
export type PublishSourcePushFn = (params: {
  tx: IntegrationTx;
  provider: string;
  workspaceId: string;
  connectionId: string;
  deliveryId: string;
  receivedAt: string;
  push: SourcePushPayload;
}) => Promise<{published: boolean}>;

export type RecordDeliveryOnlyFn = (params: {
  tx: IntegrationTx;
  provider: string;
  deliveryId: string;
}) => Promise<void>;

export type GetIntegrationConnectionByIdFn = (
  id: string,
  options?: {tx?: IntegrationTx},
) => Promise<IntegrationConnection | undefined>;

export type UpdateIntegrationConnectionLifecycleStatusFn = (
  params: {id: string; lifecycleStatus: IntegrationConnectionLifecycleStatus},
  options?: {tx?: IntegrationTx},
) => Promise<unknown>;
