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

export const jiraAgentToolIds = [
  'get_issue',
  'search_issues',
  'get_issue_comments',
  'get_issue_transitions',
  'get_project',
  'get_user',
  'create_issue',
  'update_issue',
  'add_comment',
  'transition_issue',
  'assign_issue',
] as const;

export const jiraAgentToolIdSchema = z.enum(jiraAgentToolIds);
export type JiraAgentToolId = z.infer<typeof jiraAgentToolIdSchema>;

export const jiraAgentToolRequiredScopes = ['read', 'write'] as const;
export const jiraAgentToolRequiredScopeSchema = z.enum(jiraAgentToolRequiredScopes);
export type JiraAgentToolRequiredScope = z.infer<typeof jiraAgentToolRequiredScopeSchema>;

export interface JiraAgentToolCatalogEntry
  extends AgentToolCatalogEntry<JiraAgentToolRequiredScope> {
  id: JiraAgentToolId;
}
