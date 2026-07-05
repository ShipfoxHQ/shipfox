import {harnessSchema, type ModelProviderRef} from '@shipfox/api-agent-dto';
import {text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {AgentWorkspaceSettings} from '#core/entities/agent-workspace-settings.js';
import {pgTable} from './common.js';

export const agentWorkspaceSettings = pgTable('workspace_settings', {
  workspaceId: uuid('workspace_id').primaryKey(),
  defaultProviderId: text('default_provider_id'),
  defaultHarnessId: text('default_harness_id'),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type AgentWorkspaceSettingsDb = typeof agentWorkspaceSettings.$inferSelect;
export type AgentWorkspaceSettingsCreateDb = typeof agentWorkspaceSettings.$inferInsert;

export function toAgentWorkspaceSettings(row: AgentWorkspaceSettingsDb): AgentWorkspaceSettings {
  const parsedHarness = harnessSchema.safeParse(row.defaultHarnessId);

  return {
    workspaceId: row.workspaceId,
    defaultProviderId: row.defaultProviderId as ModelProviderRef | null,
    defaultHarnessId: parsedHarness.success ? parsedHarness.data : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
