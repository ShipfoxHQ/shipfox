import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export type {UpsertAgentProviderConfigParams} from './agent-provider-configs.js';
export {
  deleteAgentProviderConfig,
  getAgentProviderConfig,
  listAgentProviderConfigs,
  upsertAgentProviderConfig,
} from './agent-provider-configs.js';
export {
  getAgentWorkspaceSettings,
  setDefaultAgentProvider,
} from './agent-workspace-settings.js';
export {closeDb, db, schema} from './db.js';
export {agentProviderConfigs} from './schema/agent-provider-configs.js';
export {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
