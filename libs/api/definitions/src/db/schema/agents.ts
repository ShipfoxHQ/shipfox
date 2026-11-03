import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import type {AgentDocument} from '@shipfox/workflow-document';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ProjectAgent, ProjectAgentError} from '#core/entities/project-agent.js';
import {pgTable} from './common.js';

export const definitionAgents = pgTable(
  'agents',
  {
    id: uuidv7PrimaryKey(),
    projectId: uuid('project_id').notNull(),
    key: text('key').notNull(),
    configPath: text('config_path').notNull(),
    name: text('name'),
    description: text('description'),
    instructions: text('instructions'),
    document: jsonb('document').notNull().$type<AgentDocument>(),
    contentHash: text('content_hash').notNull(),
    lastError: jsonb('last_error').$type<ProjectAgentError>(),
    fetchedAt: timestamp('fetched_at', {withTimezone: true}).notNull().defaultNow(),
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
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    document: row.document,
    contentHash: row.contentHash,
    lastError: row.lastError ?? null,
    fetchedAt: row.fetchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
