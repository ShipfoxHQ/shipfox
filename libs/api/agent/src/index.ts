import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';

export type {AgentProviderConfig, AgentWorkspaceSettings} from '#core/index.js';
export {
  db,
  deleteAgentProviderConfig,
  getAgentProviderConfig,
  getAgentWorkspaceSettings,
  listAgentProviderConfigs,
  migrationsPath,
  setDefaultAgentProvider,
  upsertAgentProviderConfig,
} from '#db/index.js';

export const agentModule: ShipfoxModule = {
  name: 'agent',
  database: {db, migrationsPath},
};
