export const AGENT_SESSION_LIFECYCLE_TASK_QUEUE = 'agent-session-lifecycle';

// The wall-clock budget is the real sweep bound; Temporal's timeout does not stop JS
// already running in the worker.
export const SESSION_RETENTION_BATCH_LIMIT = 200;
export const SESSION_RETENTION_TIME_BUDGET_MS = 4 * 60_000;
export const SESSION_RETENTION_MAX_ITERATIONS = 1_000;

export const AGENT_CONVERSATION_TASK_QUEUE = 'agent-conversation';
export const AGENT_CONVERSATION_WORKFLOW_NAME = 'agentConversationWorkflow';
export const CONVERSATION_WAKE_SIGNAL_NAME = 'wake';

/** One workflow per conversation, so a wake for a running conversation reaches that workflow. */
export function agentConversationWorkflowId(conversationId: string): string {
  return `agent-conversation:${conversationId}`;
}

/** Model calls a turn makes. A turn that needs another one fails with `step_limit`. */
export const MODEL_CALLS_PER_TURN = 25;

/** Concurrent activities one API process runs on the conversation queue. Temporal queues the rest. */
export const CONVERSATION_MAX_CONCURRENT_ACTIVITIES = 50;

export const MODEL_CALL_MAX_ATTEMPTS = 3;
export const TOOL_CALL_MAX_ATTEMPTS = 3;
