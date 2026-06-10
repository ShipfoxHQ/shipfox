import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  UpdateConnectionLifecycleStatusFn,
} from '#core/webhook.js';

/**
 * The capabilities a Sentry webhook handler needs from the rest of the system.
 * `@shipfox/api-integration-core` owns and wires these in production; tests fake
 * them with spies. Passing them in keeps the route decoupled from core's
 * persistence and avoids a package dependency cycle.
 */
export interface SentryWebhookContext {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateConnectionLifecycleStatus: UpdateConnectionLifecycleStatusFn;
}
