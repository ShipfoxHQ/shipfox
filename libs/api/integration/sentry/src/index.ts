import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-core-dto';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createSentryWebhookRoutes} from '#presentation/routes/webhooks.js';

export {handleSentryInstallationLifecycle, handleSentryIssueEvent} from '#core/webhook.js';
export type {
  SentryInstallation,
  SentryInstallationStatus,
  UpsertSentryInstallationParams,
} from '#db/installations.js';
export {
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
  upsertSentryInstallation,
} from '#db/installations.js';
export {closeDb, db, migrationsPath};

export interface CreateSentryIntegrationProviderOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
}

export function createSentryIntegrationProvider(options: CreateSentryIntegrationProviderOptions) {
  return {
    provider: 'sentry' as const,
    displayName: 'Sentry',
    routes: [
      createSentryWebhookRoutes({
        coreDb: options.coreDb,
        publishIntegrationEventReceived: options.publishIntegrationEventReceived,
        recordDeliveryOnly: options.recordDeliveryOnly,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
        updateConnectionLifecycleStatus: options.updateConnectionLifecycleStatus,
      }),
    ],
  };
}
