import type {AgentThinking, SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AgentProviderConfig} from '#core/entities/agent-provider-config.js';
import {pgTable} from './common.js';

export const agentProviderConfigs = pgTable(
  'provider_configs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    providerId: text('provider_id').notNull(),
    encryptedCredentials: jsonb('encrypted_credentials').$type<Record<string, string>>().notNull(),
    keyFingerprints: jsonb('key_fingerprints').$type<Record<string, string>>().notNull(),
    defaultModel: text('default_model').notNull(),
    defaultThinking: text('default_thinking').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_provider_configs_workspace_provider_unique').on(
      table.workspaceId,
      table.providerId,
    ),
  ],
);

export type AgentProviderConfigDb = typeof agentProviderConfigs.$inferSelect;
export type AgentProviderConfigCreateDb = typeof agentProviderConfigs.$inferInsert;

export function toAgentProviderConfig(row: AgentProviderConfigDb): AgentProviderConfig {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    providerId: row.providerId as SupportedAgentProviderId,
    encryptedCredentials: row.encryptedCredentials,
    keyFingerprints: row.keyFingerprints,
    defaultModel: row.defaultModel,
    defaultThinking: row.defaultThinking as AgentThinking,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
