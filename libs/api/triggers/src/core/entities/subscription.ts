export interface TriggerSubscription {
  id: string;
  workspaceId: string;
  projectId: string;
  workflowDefinitionId: string;
  name: string;
  source: string;
  event: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
