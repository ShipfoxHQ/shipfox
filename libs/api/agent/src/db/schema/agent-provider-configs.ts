import type {
  AgentProviderApi,
  AgentThinking,
  CustomAgentModelDto,
  CustomProviderHeaderDto,
  SupportedAgentProviderId,
} from '@shipfox/api-agent-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AgentProviderConfig} from '#core/entities/agent-provider-config.js';
import {pgTable} from './common.js';

export const agentProviderConfigs = pgTable(
  'provider_configs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    providerId: text('provider_id').notNull(),
    kind: text('kind').$type<'builtin' | 'custom'>().notNull().default('builtin'),
    displayName: text('display_name'),
    api: text('api').$type<AgentProviderApi>(),
    baseUrl: text('base_url'),
    headers: jsonb('headers').$type<CustomProviderHeaderDto[]>(),
    models: jsonb('models').$type<CustomAgentModelDto[]>(),
    encryptedCredentials: jsonb('encrypted_credentials').$type<Record<string, string>>().notNull(),
    keyFingerprints: jsonb('key_fingerprints').$type<Record<string, string>>().notNull(),
    defaultModel: text('default_model'),
    defaultThinking: text('default_thinking').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_provider_configs_workspace_provider_unique').on(
      table.workspaceId,
      table.providerId,
    ),
    check(
      'agent_provider_configs_custom_required_fields',
      sql`${table.kind} <> 'custom' OR (${table.api} IS NOT NULL AND ${table.baseUrl} IS NOT NULL AND ${table.models} IS NOT NULL AND ${table.displayName} IS NOT NULL)`,
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
    kind: row.kind,
    displayName: row.displayName,
    api: row.api,
    baseUrl: row.baseUrl,
    headers: row.headers,
    models: row.models,
    encryptedCredentials: row.encryptedCredentials,
    keyFingerprints: row.keyFingerprints,
    defaultModel: row.defaultModel,
    defaultThinking: row.defaultThinking as AgentThinking,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
