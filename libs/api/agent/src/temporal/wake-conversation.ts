import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {
  AGENT_CONVERSATION_TASK_QUEUE,
  AGENT_CONVERSATION_WORKFLOW_NAME,
  agentConversationWorkflowId,
  CONVERSATION_WAKE_SIGNAL_NAME,
} from './constants.js';

/**
 * Tells a conversation to look at its inputs again, starting its workflow when none runs. The
 * input is already in Postgres, so a failure is logged and never fails the caller. The recovery
 * sweep picks up what a failed wake missed.
 */
export async function wakeConversation(conversationId: string): Promise<void> {
  try {
    await temporalClient().workflow.signalWithStart(AGENT_CONVERSATION_WORKFLOW_NAME, {
      taskQueue: AGENT_CONVERSATION_TASK_QUEUE,
      workflowId: agentConversationWorkflowId(conversationId),
      args: [{conversationId}],
      signal: CONVERSATION_WAKE_SIGNAL_NAME,
    });
  } catch (error) {
    logger().warn({err: error, conversationId}, 'Failed to wake an agent conversation');
  }
}
