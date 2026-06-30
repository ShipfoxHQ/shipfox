/**
 * A user-fixable agent-step configuration failure: an unknown provider, a
 * provider/model pair pi does not know, or workspace provider credentials that
 * are missing or incomplete. The step layer translates this to the
 * `agent_config_invalid` reason, distinct from a genuine provider/API failure
 * (`agent_invocation_failed`).
 */
export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigError';
  }
}
