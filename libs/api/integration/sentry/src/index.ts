import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-core-dto';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createSentryApiClient, type SentryApiClient} from '#api/client.js';
import {closeDb, db} from '#db/db.js';
import {getSentryInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateSentryIntegrationRoutesOptions,
  createSentryIntegrationRoutes,
} from '#presentation/routes/install.js';
import {createSentryWebhookRoutes} from '#presentation/routes/webhooks.js';

export type {SentryApiClient} from '#api/client.js';
export {
  SentryInstallationAlreadyLinkedError,
  SentryIntegrationProviderError,
} from '#core/errors.js';
export type {ConnectSentryInstallationInput} from '#core/install.js';
export {handleSentryConnect} from '#core/install.js';
export {handleSentryInstallationLifecycle, handleSentryIssueEvent} from '#core/webhook.js';
export type {
  SentryInstallation,
  SentryInstallationStatus,
  UpsertSentryInstallationParams,
} from '#db/installations.js';
export {
  getSentryInstallationByConnectionId,
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
  upsertSentryInstallation,
} from '#db/installations.js';
export {closeDb, db, migrationsPath};

export interface CreateSentryIntegrationProviderOptions
  extends Omit<CreateSentryIntegrationRoutesOptions, 'sentry'> {
  sentry?: SentryApiClient | undefined;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
  getSentryInstallationByConnectionId?: typeof getSentryInstallationByConnectionId | undefined;
}

export function createSentryIntegrationProvider(options: CreateSentryIntegrationProviderOptions) {
  const sentry = options.sentry ?? createSentryApiClient();
  const getInstallationByConnectionId =
    options.getSentryInstallationByConnectionId ?? getSentryInstallationByConnectionId;

  return {
    provider: 'sentry' as const,
    displayName: 'Sentry',
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation?.orgSlug) return undefined;
      return `https://sentry.io/organizations/${encodeURIComponent(installation.orgSlug)}/`;
    },
    routes: [
      createSentryIntegrationRoutes({
        sentry,
        getExistingSentryConnection: options.getExistingSentryConnection,
        connectSentryInstallation: options.connectSentryInstallation,
      }),
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
