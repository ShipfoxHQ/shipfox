export interface AgentInvocation {
  readonly cwd: string;
  readonly model: string;
  readonly thinking: string;
  readonly prompt: string;
  readonly signal: AbortSignal;
}

export interface AgentRunResult {
  // The agent's final assistant message, for runner-side observability. Not sent to
  // the API in v1 (StepResult.output stays runner-local), so it is optional.
  readonly summary?: string;
}

// Runs an AI coding agent against a job workspace. v1 has one implementation (pi).
// Process-success semantics: `run` resolves when the agent's turn completes; it
// throws on a harness/provider failure or on abort. The caller maps a resolved call
// to a succeeded step and a thrown call to a failed step.
export interface AgentHarness {
  run(invocation: AgentInvocation): Promise<AgentRunResult>;
}
