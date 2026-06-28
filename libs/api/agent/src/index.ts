import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';
import {routes} from '#presentation/index.js';

export {
  type AgentProviderConfig,
  AgentProviderConfigNotFoundError,
  AgentProviderValidationError,
  type AgentWorkspaceSettings,
  buildAgentProviderCatalog,
  CredentialDecryptionError,
  decryptCredentials,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ProviderValidationUnavailableError,
  testAndSaveProviderConfig,
  UnsupportedAgentProviderError,
} from '#core/index.js';
export {
  deleteAgentProviderConfig,
  getAgentProviderConfig,
  getAgentWorkspaceSettings,
  listAgentProviderConfigs,
  setDefaultAgentProvider,
  upsertAgentProviderConfig,
} from '#db/index.js';

export const agentModule: ShipfoxModule = {
  name: 'agent',
  database: {db, migrationsPath},
  routes,
};
