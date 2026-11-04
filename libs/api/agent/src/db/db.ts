import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';
import {conversationItems} from './schema/conversation-items.js';
import {conversationRunLinks} from './schema/conversation-run-links.js';
import {conversations} from './schema/conversations.js';
import {sessionDataKeys} from './schema/data-keys.js';
import {agentDeletedScopes} from './schema/deleted-scopes.js';
import {modelProviderConfigs} from './schema/model-provider-configs.js';
import {replyDeliveries} from './schema/reply-deliveries.js';
import {sessions} from './schema/sessions.js';
import {toolCallStarts} from './schema/tool-call-starts.js';
import {turnStreamChunks} from './schema/turn-stream-chunks.js';
import {turns} from './schema/turns.js';

export const schema = {
  modelProviderConfigs,
  agentWorkspaceSettings,
  sessions,
  sessionDataKeys,
  agentDeletedScopes,
  conversations,
  conversationItems,
  conversationRunLinks,
  turns,
  toolCallStarts,
  turnStreamChunks,
  replyDeliveries,
};

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let _db: Database | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
