import {
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
  continueAsNew,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  TimeoutFailure,
  workflowInfo,
} from '@temporalio/workflow';
import type {CompactionCause} from '#core/turn-runtime/compaction.js';
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

const {deliverReply: deliverReplyActivity} = proxyActivities<ConversationActivities>({
  startToCloseTimeout: '1 minute',
  retry: {maximumAttempts: 3},
});

const {modelCall, compactConversation} = proxyActivities<ConversationActivities>({
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

/**
 * Sends a turn's outcome, or a denial's when there is no turn. A reply that can't be sent doesn't
 * end the conversation: the next input still gets its turn.
 */
async function deliverReply(input: {conversationId: string; turnId?: string}): Promise<void> {
  try {
    await deliverReplyActivity(input);
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    log.warn('Failed to deliver the reply of an agent conversation', {
      conversationId: input.conversationId,
      error: String(error),
    });
  }
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

/**
 * Compacts the prompt, so the same model call can run again. When it can't, the turn fails: a
 * second compaction for the same call, or nothing left to summarize, means the prompt can't fit.
 * Returns whether the turn goes on.
 */
async function compactOrFail(params: {
  conversationId: string;
  turnId: string;
  modelCallIndex: number;
  cause: CompactionCause;
  alreadyCompacted: boolean;
}): Promise<boolean> {
  const {alreadyCompacted, ...input} = params;
  if (!alreadyCompacted && (await compactConversation(input)).compacted) return true;
  await finishTurn({
    conversationId: params.conversationId,
    turnId: params.turnId,
    status: 'failed',
    failureCode: 'context_overflow',
  });
  return false;
}

/** `again` runs the same model call once more, after a compaction. `done` ends the turn. */
type ModelStep = 'next' | 'again' | 'done';

async function runModelStep(params: {
  conversationId: string;
  turnId: string;
  modelCallIndex: number;
  alreadyCompacted: boolean;
}): Promise<ModelStep> {
  const {conversationId, turnId, modelCallIndex} = params;
  // A message or result that arrived since the last call joins the turn here, never inside a tool call.
  const claim = await claimPendingInputs({conversationId, turnId});
  if (claim.stopRequested) {
    await finishTurn({conversationId, turnId, status: 'stopped'});
    return 'done';
  }
  const result = await modelCall({conversationId, turnId, modelCallIndex});
  if (result.stopReason === 'stopped') {
    await finishTurn({conversationId, turnId, status: 'stopped'});
    return 'done';
  }
  if (result.stopReason === 'compact') {
    const proceed = await compactOrFail({
      conversationId,
      turnId,
      modelCallIndex,
      cause: result.compactionCause,
      alreadyCompacted: params.alreadyCompacted,
    });
    return proceed ? 'again' : 'done';
  }
  if (result.toolCallCount === 0) {
    await finishTurn({conversationId, turnId, status: 'succeeded'});
    return 'done';
  }
  for (let callIndex = 0; callIndex < result.toolCallCount; callIndex += 1) {
    await toolCall({conversationId, turnId, modelCallIndex, callIndex});
  }
  return 'next';
}

async function runTurn(params: {conversationId: string; turnId: string}): Promise<void> {
  const {conversationId, turnId} = params;
  try {
    // The model call that last compacted. A second compaction for the same call means the prompt
    // can't fit, so the turn fails instead of looping.
    let compactedModelCall: number | undefined;
    for (let modelCallIndex = 0; ; ) {
      if (modelCallIndex >= MODEL_CALLS_PER_TURN) {
        await finishTurn({conversationId, turnId, status: 'failed', failureCode: 'step_limit'});
        return;
      }
      const step = await runModelStep({
        conversationId,
        turnId,
        modelCallIndex,
        alreadyCompacted: compactedModelCall === modelCallIndex,
      });
      if (step === 'done') return;
      if (step === 'again') compactedModelCall = modelCallIndex;
      else modelCallIndex += 1;
    }
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    await finishTurn({conversationId, turnId, status: 'failed', failureCode: failureCodeOf(error)});
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
      // A denial opens no turn, and its notice is the only reply it has.
      await deliverReply({conversationId});
      // A wake that arrived while beginTurn ran may have queued something it missed.
      if (woken) continue;
      return;
    }
    await runTurn({conversationId, turnId: turn.turnId});
    await deliverReply({conversationId, turnId: turn.turnId});
    if (workflowInfo().continueAsNewSuggested)
      await continueAsNew<typeof agentConversationWorkflow>({conversationId});
  }
}
