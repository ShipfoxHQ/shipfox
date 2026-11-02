import {
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  TimeoutFailure,
  workflowInfo,
} from '@temporalio/workflow';
import {isTurnFailureCode, type TurnFailureCode} from '#core/turn-runtime/failure-codes.js';
import type {ConversationActivities} from '../activities/conversation.js';
import {
  CONVERSATION_WAKE_SIGNAL_NAME,
  MODEL_CALL_MAX_ATTEMPTS,
  MODEL_CALLS_PER_TURN,
  TOOL_CALL_MAX_ATTEMPTS,
} from '../constants.js';

const {beginTurn, claimPendingInputs, finishTurn} = proxyActivities<ConversationActivities>({
  startToCloseTimeout: '30 seconds',
});

const {modelCall} = proxyActivities<ConversationActivities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {maximumAttempts: MODEL_CALL_MAX_ATTEMPTS},
});

const {toolCall} = proxyActivities<ConversationActivities>({
  startToCloseTimeout: '2 minutes',
  retry: {maximumAttempts: TOOL_CALL_MAX_ATTEMPTS},
});

/** Says "look again". Inputs live in Postgres, so a signal carries nothing. */
export const wakeSignal = defineSignal(CONVERSATION_WAKE_SIGNAL_NAME);

export interface AgentConversationInput {
  conversationId: string;
}

function failureCodeOf(error: unknown): TurnFailureCode {
  if (error instanceof ActivityFailure) {
    if (error.cause instanceof ApplicationFailure) {
      const type = error.cause.type;
      return isTurnFailureCode(type) ? type : 'internal_error';
    }
    if (error.cause instanceof TimeoutFailure) return 'timeout';
  }
  return 'internal_error';
}

async function runTurn(params: {conversationId: string; turnId: string}): Promise<void> {
  const {conversationId, turnId} = params;
  try {
    for (let modelCallIndex = 0; ; modelCallIndex += 1) {
      if (modelCallIndex >= MODEL_CALLS_PER_TURN) {
        await finishTurn({conversationId, turnId, status: 'failed', failureCode: 'step_limit'});
        return;
      }
      // A message or result that arrived since the last call joins the turn here, never inside a tool call.
      await claimPendingInputs({conversationId});
      const {toolCallCount} = await modelCall({conversationId, turnId, modelCallIndex});
      if (toolCallCount === 0) {
        await finishTurn({conversationId, turnId, status: 'succeeded'});
        return;
      }
      for (let callIndex = 0; callIndex < toolCallCount; callIndex += 1) {
        await toolCall({conversationId, turnId, modelCallIndex, callIndex});
      }
    }
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    await finishTurn({
      conversationId,
      turnId,
      status: 'failed',
      failureCode: failureCodeOf(error),
    });
  }
}

/**
 * Runs the turns of one conversation, one at a time. It ends when nothing is queued, so no
 * workflow lives for days. A failed turn doesn't end the loop: it keeps its inputs claimed, so
 * the next turn sees only what arrived later.
 */
export async function agentConversationWorkflow({
  conversationId,
}: AgentConversationInput): Promise<void> {
  let woken = false;
  setHandler(wakeSignal, () => {
    woken = true;
  });

  while (true) {
    woken = false;
    const turn = await beginTurn({conversationId});
    if (turn === undefined) {
      // A wake that arrived while beginTurn ran may have queued something it missed.
      if (woken) continue;
      return;
    }
    await runTurn({conversationId, turnId: turn.turnId});
    if (workflowInfo().continueAsNewSuggested)
      await continueAsNew<typeof agentConversationWorkflow>({conversationId});
  }
}
