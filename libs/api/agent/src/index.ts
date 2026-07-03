import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';
import {routes} from '#presentation/index.js';

export {
  type AgentConfigResolutionContext,
  type AgentDefaultsResolver,
  type AgentWorkspaceSettings,
  buildModelProviderCatalog,
  type ContextualAgentConfig,
  catalogDefaultAgentResolver,
  createWorkspaceAgentDefaultsResolver,
  deleteModelProviderConfig,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  type ModelProviderConfig,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
  ModelProviderValidationUnavailableError,
  type ResolvedAgentConfig,
  type ResolveRuntimeCredentialsParams,
  resolveAgentConfig,
  resolveRuntimeCredentials,
  testAndSaveModelProviderConfig,
  UnsupportedModelProviderError,
} from '#core/index.js';
export {
  getAgentWorkspaceSettings,
  getModelProviderConfig,
  listModelProviderConfigs,
  setDefaultModelProvider,
  upsertModelProviderConfig,
} from '#db/index.js';

export const agentModule: ShipfoxModule = {
  name: 'agent',
  database: {db, migrationsPath},
  routes,
};
