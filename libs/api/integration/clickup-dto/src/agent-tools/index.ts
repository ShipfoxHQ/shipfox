import {z} from 'zod';

interface AgentToolCatalogEntry<RequiredScope = unknown> {
  id: string;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: RequiredScope;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | undefined;
}

export const clickupAgentToolIds = [
  'get_task',
  'search_tasks',
  'get_task_comments',
  'create_task',
  'update_task',
  'add_comment',
] as const;

export const clickupAgentToolIdSchema = z.enum(clickupAgentToolIds);
export type ClickUpAgentToolId = z.infer<typeof clickupAgentToolIdSchema>;

export const clickupAgentToolRequiredScopes = ['read', 'write'] as const;
export const clickupAgentToolRequiredScopeSchema = z.enum(clickupAgentToolRequiredScopes);
export type ClickUpAgentToolRequiredScope = z.infer<typeof clickupAgentToolRequiredScopeSchema>;

export interface ClickUpAgentToolCatalogEntry
  extends AgentToolCatalogEntry<ClickUpAgentToolRequiredScope> {
  id: ClickUpAgentToolId;
}
