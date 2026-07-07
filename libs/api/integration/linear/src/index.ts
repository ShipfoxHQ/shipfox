import {LINEAR_PROVIDER} from '@shipfox/api-integration-linear-dto';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {getLinearInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';

export type {LinearProvider} from '@shipfox/api-integration-linear-dto';
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
  LinearConnectionAlreadyLinkedError,
  LinearInstallationAlreadyLinkedError,
} from '#core/errors.js';
export type {
  LinearInstallation,
  LinearInstallationStatus,
  UpsertLinearInstallationParams,
} from '#db/installations.js';
export {
  getLinearInstallationByConnectionId,
  getLinearInstallationByOrganizationId,
  markLinearInstallationRevoked,
  upsertLinearInstallation,
} from '#db/installations.js';
export {closeDb, config, db, migrationsPath};

export interface CreateLinearIntegrationProviderOptions {
  getLinearInstallationByConnectionId?: typeof getLinearInstallationByConnectionId | undefined;
}

export function createLinearIntegrationProvider(
  options: CreateLinearIntegrationProviderOptions = {},
) {
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
  };
}
