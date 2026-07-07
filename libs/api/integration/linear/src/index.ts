import {LINEAR_PROVIDER} from '@shipfox/api-integration-linear-dto';
import {createLinearApiClient, type LinearApiClient} from '#api/client.js';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {getLinearInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateLinearIntegrationRoutesOptions,
  createLinearIntegrationRoutes,
} from '#presentation/routes/install.js';

export type {LinearProvider} from '@shipfox/api-integration-linear-dto';
export type {LinearApiClient, LinearAuthorization, LinearIdentity} from '#api/client.js';
export {createLinearApiClient} from '#api/client.js';
export type {
  LinearAgentToolCatalogEntry,
  LinearAgentToolCategory,
  LinearAgentToolId,
  LinearAgentToolRequiredScope,
} from '#core/agent-tools.js';
export {
  linearAgentToolCatalog,
  linearAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
export {
  LinearAccessTokenMissingError,
  LinearConnectionAlreadyLinkedError,
  LinearConnectionNotFoundError,
  LinearInstallationAlreadyLinkedError,
  LinearInstallStateActorMismatchError,
  LinearInstallStateError,
  LinearIntegrationProviderError,
  LinearTokenUnrefreshableError,
} from '#core/errors.js';
export type {ConnectLinearInstallationInput, HandleLinearCallbackParams} from '#core/install.js';
export {handleLinearCallback} from '#core/install.js';
export type {LinearInstallStateClaims} from '#core/state.js';
export {signLinearInstallState, verifyLinearInstallState} from '#core/state.js';
export type {
  CreateLinearTokenStoreParams,
  GetLinearAccessTokenParams,
  LinearConnectionResolverResult,
  LinearSecretsStore,
  LinearTokenStore,
  StoreLinearTokensParams,
} from '#core/tokens.js';
export {
  createLinearTokenStore,
  linearSecretsNamespace,
} from '#core/tokens.js';
export type {
  LinearInstallation,
  LinearInstallationStatus,
  UpdateLinearInstallationTokenExpiryParams,
  UpsertLinearInstallationParams,
} from '#db/installations.js';
export {
  getLinearInstallationByConnectionId,
  getLinearInstallationByOrganizationId,
  markLinearInstallationRevoked,
  updateLinearInstallationTokenExpiry,
  upsertLinearInstallation,
  withLinearRefreshLock,
} from '#db/installations.js';
export {closeDb, config, db, migrationsPath};

export interface CreateLinearIntegrationProviderOptions {
  linear?: LinearApiClient | undefined;
  getLinearInstallationByConnectionId?: typeof getLinearInstallationByConnectionId | undefined;
  routes?: Omit<CreateLinearIntegrationRoutesOptions, 'linear'> | undefined;
}

export function createLinearIntegrationProvider(
  options: CreateLinearIntegrationProviderOptions = {},
) {
  const linear = options.linear ?? createLinearApiClient();
  const getInstallationByConnectionId =
    options.getLinearInstallationByConnectionId ?? getLinearInstallationByConnectionId;

  return {
    provider: LINEAR_PROVIDER,
    displayName: 'Linear',
    adapters: {},
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation?.organizationUrlKey) return undefined;
      return `https://linear.app/${encodeURIComponent(installation.organizationUrlKey)}/settings`;
    },
    routes: options.routes
      ? [
          createLinearIntegrationRoutes({
            linear,
            ...options.routes,
          }),
        ]
      : [],
  };
}
