import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';
import {routes} from '#presentation/index.js';

export {
  type AgentConfigResolutionContext,
  type AgentDefaultsResolver,
  type AgentProviderConfig,
  AgentProviderConfigNotFoundError,
  AgentProviderValidationError,
  type AgentWorkspaceSettings,
  buildAgentProviderCatalog,
  type ContextualAgentConfig,
  CredentialDecryptionError,
  catalogDefaultAgentResolver,
  createWorkspaceAgentDefaultsResolver,
  decryptCredentials,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ProviderValidationUnavailableError,
  type ResolvedAgentConfig,
  resolveAgentConfig,
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
