import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {newConversationRecordId} from '#db/conversations.js';
import {appendTurnEntry, getConversationById, getTurnById, getTurnEntry} from '#db/turn-runtime.js';
import {conversationToolCallCount} from '#metrics/index.js';
import {CONVERSATION_SESSION_VERSION, parseConversationEntry} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
  sealConversationEntry,
} from '../conversation-sealing.js';
import type {Conversation} from '../entities/conversation.js';
import {listConversationToolSet} from './conversation-tools.js';
import {toolResultMessageEntry} from './entries.js';
import {TurnFailure} from './failures.js';
import {wrapToolResultText} from './tool-result.js';

export interface ToolCallParams {
  conversationId: string;
  turnId: string;
  modelCallIndex: number;
  callIndex: number;
  integrations: IntegrationsModuleClient;
  /** True when Temporal won't retry the activity again, so a failure has to be recorded. */
  lastAttempt: boolean;
}

export interface ToolCallResult {
  status: 'success' | 'error';
}

interface RequestedToolCall {
  assistantItemId: string;
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

async function readRequestedCall(params: {
  conversation: Conversation;
  turnId: string;
  modelCallIndex: number;
  callIndex: number;
}): Promise<RequestedToolCall> {
  const assistant = await getTurnEntry({
    turnId: params.turnId,
    modelCallIndex: params.modelCallIndex,
  });
  if (!assistant)
    throw new TurnFailure('internal_error', 'The model call has no stored reply', false);

  const {workspaceId} = params.conversation;
  const text = openConversationEntry({
    key: await conversationDataKey(workspaceId),
    aad: aadForConversationItem({
      workspaceId,
      conversationId: assistant.conversationId,
      itemId: assistant.id,
    }),
    sealed: assistant.sealedEntry,
  });
  const message = parseConversationEntry(text)?.message as {content?: unknown} | undefined;
  const calls = (Array.isArray(message?.content) ? message.content : []).filter(
    (block): block is {type: 'toolCall'; id: string; name: string; arguments?: unknown} =>
      (block as {type?: unknown}).type === 'toolCall',
  );
  const call = calls[params.callIndex];
  if (!call)
    throw new TurnFailure('internal_error', 'The stored reply has no such tool call', false);

  const args = call.arguments;
  return {
    assistantItemId: assistant.id,
    id: call.id,
    name: call.name,
    arguments:
      typeof args === 'object' && args !== null && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {},
  };
}

interface ToolOutput {
  text: string;
  isError: boolean;
  sensitivity: 'read' | 'write' | 'local' | 'unknown';
}

function contentText(content: readonly Record<string, unknown>[], result: unknown): string {
  const parts = content.flatMap((block) => (typeof block.text === 'string' ? [block.text] : []));
  if (parts.length > 0) return parts.join('\n');
  return result === null || result === undefined ? '' : JSON.stringify(result);
}

async function executeTool(params: {
  conversation: Conversation;
  turnId: string;
  call: RequestedToolCall;
  callIndex: number;
  integrations: IntegrationsModuleClient;
}): Promise<ToolOutput> {
  const {call, conversation} = params;
  const {tools} = await listConversationToolSet(params.integrations).catch((error: unknown) => {
    throw new TurnFailure('tool_catalog_unavailable', 'The tool catalog is unavailable', true, {
      cause: error,
    });
  });
  const entry = tools.find((tool) => tool.name === call.name);
  if (!entry) {
    return {text: `Unknown tool "${call.name}"`, isError: true, sensitivity: 'unknown'};
  }

  if (entry.kind === 'local') {
    const result = entry.tool.execute(call.arguments);
    return {
      text: result.content.map((block) => block.text).join('\n'),
      isError: result.isError === true,
      sensitivity: 'local',
    };
  }

  try {
    const outcome = await params.integrations.callTool({
      workspaceId: conversation.workspaceId,
      connectionId: entry.connectionId,
      tool: entry.tool,
      arguments: call.arguments,
      caller: {
        kind: 'conversation',
        projectId: conversation.projectId,
        conversationId: conversation.id,
        turnId: params.turnId,
        callItemId: `${call.assistantItemId}:${params.callIndex}`,
        ...(conversation.ownerUserId === null ? {} : {actorUserId: conversation.ownerUserId}),
      },
    });
    return outcome.outcome === 'success'
      ? {
          text: contentText(outcome.content, outcome.result),
          isError: false,
          sensitivity: entry.tool.sensitivity,
        }
      : {
          text: `${outcome.code}: ${outcome.message}`,
          isError: true,
          sensitivity: entry.tool.sensitivity,
        };
  } catch (error) {
    // A known error is the same however often the call repeats, so the model gets to read it.
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      return {text: error.message, isError: true, sensitivity: entry.tool.sensitivity};
    }
    throw error;
  }
}

/**
 * One tool call of a stored assistant reply. It reads the call from the stored entry, runs it,
 * and stores a `toolResult` entry, capped and wrapped as untrusted data. The result is unique per
 * call, so a repeat after a crash returns what the first attempt stored. When the activity has no
 * retries left, the failure itself becomes the result and the model decides what to do.
 */
export async function runToolCall(params: ToolCallParams): Promise<ToolCallResult> {
  const position = {
    turnId: params.turnId,
    modelCallIndex: params.modelCallIndex,
    callIndex: params.callIndex,
  };
  const existing = await getTurnEntry(position);
  if (existing) {
    conversationToolCallCount.add(1, {sensitivity: 'unknown', outcome: 'replayed'});
    return {status: existing.meta.is_error ? 'error' : 'success'};
  }

  const [conversation, turn] = await Promise.all([
    getConversationById(params.conversationId),
    getTurnById(params.turnId),
  ]);
  if (!conversation || !turn) {
    throw new TurnFailure('internal_error', 'The turn or its conversation is gone', false);
  }
  const call = await readRequestedCall({
    conversation,
    turnId: params.turnId,
    modelCallIndex: params.modelCallIndex,
    callIndex: params.callIndex,
  });

  let output: ToolOutput;
  try {
    output = await executeTool({
      conversation,
      turnId: params.turnId,
      call,
      callIndex: params.callIndex,
      integrations: params.integrations,
    });
  } catch (error) {
    if (!params.lastAttempt) throw error;
    reportError(error, {boundary: 'agent.conversation.tool_call'});
    output = {text: 'The tool failed to run', isError: true, sensitivity: 'unknown'};
  }

  const itemId = await newConversationRecordId();
  await appendTurnEntry({
    conversationId: conversation.id,
    position,
    completesModelCall: false,
    entry: {
      id: itemId,
      entryType: 'message',
      sessionVersion: CONVERSATION_SESSION_VERSION,
      sealedEntry: sealConversationEntry({
        key: await conversationDataKey(conversation.workspaceId),
        aad: aadForConversationItem({
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          itemId,
        }),
        entry: toolResultMessageEntry({
          toolCallId: call.id,
          toolName: call.name,
          text: wrapToolResultText({toolName: call.name, text: output.text}),
          isError: output.isError,
        }),
      }),
      meta: {
        role: 'toolResult',
        tool_call_id: call.id,
        tool_name: call.name,
        ...(output.isError ? {is_error: true} : {}),
      },
    },
  });
  conversationToolCallCount.add(1, {
    sensitivity: output.sensitivity,
    outcome: output.isError ? 'error' : 'success',
  });
  return {status: output.isError ? 'error' : 'success'};
}
