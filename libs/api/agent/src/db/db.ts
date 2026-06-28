import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {agentProviderConfigs} from './schema/agent-provider-configs.js';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';

export const schema = {
  agentProviderConfigs,
  agentWorkspaceSettings,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
