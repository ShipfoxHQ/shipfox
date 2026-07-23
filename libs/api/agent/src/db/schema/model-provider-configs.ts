import type {
  AgentThinking,
  CustomAgentModelDto,
  CustomModelProviderHeaderDto,
  ModelProviderApi,
  ModelProviderRef,
} from '@shipfox/api-agent-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  boolean,
  check,
  jsonb,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {ModelProviderConfig} from '#core/entities/model-provider-config.js';
import {pgTable} from './common.js';

export const modelProviderConfigKindEnum = pgEnum('agent_model_provider_config_kind', [
  'builtin',
  'custom',
]);

export const modelProviderConfigs = pgTable(
  'model_provider_configs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    providerId: text('provider_id').notNull(),
    kind: modelProviderConfigKindEnum('kind').notNull().default('builtin'),
    displayName: text('display_name'),
    api: text('api').$type<ModelProviderApi>(),
    baseUrl: text('base_url'),
    headers: jsonb('headers').$type<CustomModelProviderHeaderDto[]>(),
    secretHeaderNames: jsonb('secret_header_names').$type<string[]>(),
    models: jsonb('models').$type<CustomAgentModelDto[]>(),
    requiresApiKey: boolean('requires_api_key').notNull().default(false),
    defaultModel: text('default_model'),
    defaultThinking: text('default_thinking').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_model_provider_configs_workspace_provider_unique').on(
      table.workspaceId,
      table.providerId,
    ),
    check(
      'agent_model_provider_configs_custom_required_fields',
      sql`${table.kind} <> 'custom' OR (${table.api} IS NOT NULL AND ${table.baseUrl} IS NOT NULL AND ${table.models} IS NOT NULL AND ${table.displayName} IS NOT NULL)`,
    ),
  ],
);

export type ModelProviderConfigDb = typeof modelProviderConfigs.$inferSelect;
export type ModelProviderConfigCreateDb = typeof modelProviderConfigs.$inferInsert;

export function toModelProviderConfig(row: ModelProviderConfigDb): ModelProviderConfig {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    providerId: row.providerId as ModelProviderRef,
    kind: row.kind,
    displayName: row.displayName,
    api: row.api,
    baseUrl: row.baseUrl,
    headers: row.headers,
    secretHeaderNames: row.secretHeaderNames,
    models: row.models,
    requiresApiKey: row.requiresApiKey,
    defaultModel: row.defaultModel,
    defaultThinking: row.defaultThinking as AgentThinking,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
