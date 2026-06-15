import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-core-dto';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {SentryApiClient} from '#api/client.js';

/**
 * The capabilities a Sentry webhook handler needs from the rest of the system.
 * `@shipfox/api-integration-core` owns and wires the core persistence in
 * production; tests fake them with spies. Passing them in keeps the route
 * decoupled from core's persistence and avoids a package dependency cycle. The
 * Sentry client is injected too so the authoritative `installation.created` path
 * can exchange the code, and tests can fake the exchange.
 */
export interface SentryWebhookContext {
  sentry: SentryApiClient;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
}
