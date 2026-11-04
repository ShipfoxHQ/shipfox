/**
 * One `on:` rule of an agent file. It claims the requests of a source for the agent, narrowed by
 * an optional filter over `request` and `event`.
 */
export interface AgentSubscription {
  id: string;
  workspaceId: string;
  projectId: string;
  agentKey: string;
  source: string;
  filter: string | null;
  /** When the binding first appeared. A sync that keeps the rule keeps this date. */
  createdAt: Date;
}
