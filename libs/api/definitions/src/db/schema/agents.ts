import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {
  ProjectAgent,
  ProjectAgentConfig,
  ProjectAgentError,
} from '#core/entities/project-agent.js';
import {pgTable} from './common.js';

export const definitionAgents = pgTable(
  'agents',
  {
    id: uuidv7PrimaryKey(),
    projectId: uuid('project_id').notNull(),
    key: text('key').notNull(),
    configPath: text('config_path').notNull(),
    config: jsonb('config').notNull().$type<ProjectAgentConfig>(),
    contentHash: text('content_hash').notNull(),
    errors: jsonb('errors').notNull().default([]).$type<ProjectAgentError[]>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('definitions_agents_project_key_unique').on(table.projectId, table.key)],
);

export type AgentDb = typeof definitionAgents.$inferSelect;
export type AgentCreateDb = typeof definitionAgents.$inferInsert;

export function toProjectAgent(row: AgentDb): ProjectAgent {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    configPath: row.configPath,
    config: row.config,
    contentHash: row.contentHash,
    errors: row.errors,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
