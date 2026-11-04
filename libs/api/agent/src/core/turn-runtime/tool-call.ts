import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {newConversationRecordId} from '#db/conversations.js';
import {
  appendTurnEntry,
  claimToolCallStart,
  getConversationById,
  getTurnById,
  getTurnEntry,
} from '#db/turn-runtime.js';
import {conversationToolCallCount} from '#metrics/index.js';
import {CONVERSATION_SESSION_VERSION, parseConversationEntry} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
  sealConversationEntry,
} from '../conversation-sealing.js';
import type {Conversation} from '../entities/conversation.js';
import {ProjectAgentNotFoundError} from '../errors.js';
import {type ResolvedProjectAgent, resolveProjectAgent} from '../project-agents.js';
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
  /** Reads the agent's file for the tools it grants. Without it, only the built-in tools exist. */
  definitions?: DefinitionsInterModuleClient | undefined;
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
  /** Set on a write that may have taken effect: a retry found it begun, it timed out, or it failed on the last attempt. */
  outcome?: 'unknown';
}

export const UNKNOWN_WRITE_OUTCOME_TEXT =
  'unknown: An earlier attempt of this call began, and Shipfox cannot tell whether it changed anything. It was not run again. Read the current state with a read tool before you try again.';

export const UNFINISHED_WRITE_OUTCOME_TEXT =
  'unknown: This call did not finish, and Shipfox cannot tell whether it changed anything. Read the current state with a read tool before you try again.';

const UNFINISHED_WRITE_OUTPUT: ToolOutput = {
  text: UNFINISHED_WRITE_OUTCOME_TEXT,
  isError: false,
  sensitivity: 'write',
  outcome: 'unknown',
};

/**
 * Whether a call can change something outside Shipfox. A family tool is a write when the method
 * it names is one, and any other call to a tool that has a write method counts as one.
 */
function isWriteCall(
  tool: {
    sensitivity: 'read' | 'write';
    methods?: readonly {id: string; sensitivity: string}[] | undefined;
  },
  args: Record<string, unknown>,
): boolean {
  if (tool.sensitivity !== 'write') return false;
  const method = tool.methods?.find((candidate) => candidate.id === args.method);
  return method === undefined ? true : method.sensitivity === 'write';
}

/** The agent whose file grants the tools, or none when it has since been deleted. */
async function readConversationAgent(params: {
  conversation: Conversation;
  definitions: DefinitionsInterModuleClient | undefined;
}): Promise<ResolvedProjectAgent | undefined> {
  const {conversation} = params;
  try {
    return await resolveProjectAgent({
      definitions: params.definitions,
      workspaceId: conversation.workspaceId,
      projectId: conversation.projectId,
      key: conversation.agentKey,
    });
  } catch (error) {
    if (error instanceof ProjectAgentNotFoundError) return undefined;
    throw error;
  }
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
  modelCallIndex: number;
  callIndex: number;
  integrations: IntegrationsModuleClient;
  definitions: DefinitionsInterModuleClient | undefined;
  lastAttempt: boolean;
}): Promise<ToolOutput> {
  const {call, conversation} = params;
  const agent = await readConversationAgent({conversation, definitions: params.definitions});
  const {tools} = await listConversationToolSet({
    integrations: params.integrations,
    workspaceId: conversation.workspaceId,
    projectId: conversation.projectId,
    agent,
  }).catch((error: unknown) => {
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

  // The start is committed before the call, so a crash or retry after it began never repeats a
  // write. The model learns the outcome is unknown and reads the state itself.
  const isWrite = isWriteCall(entry.tool, call.arguments);
  if (
    isWrite &&
    !(await claimToolCallStart({
      turnId: params.turnId,
      modelCallIndex: params.modelCallIndex,
      callIndex: params.callIndex,
    }))
  ) {
    return {
      text: UNKNOWN_WRITE_OUTCOME_TEXT,
      isError: false,
      sensitivity: 'write',
      outcome: 'unknown',
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
        agentKey: conversation.agentKey,
        turnId: params.turnId,
        callItemId: `${call.assistantItemId}:${params.callIndex}`,
        ...(conversation.ownerUserId === null ? {} : {actorUserId: conversation.ownerUserId}),
        ...(entry.grantedByAgent ? {grantedByAgent: true} : {}),
      },
    });
    if (outcome.outcome === 'success') {
      return {
        text: contentText(outcome.content, outcome.result),
        isError: false,
        sensitivity: entry.tool.sensitivity,
      };
    }
    // The provider may have applied a write before it timed out.
    if (isWrite && outcome.code === 'provider-timeout') return UNFINISHED_WRITE_OUTPUT;
    return {
      text: `${outcome.code}: ${outcome.message}`,
      isError: true,
      sensitivity: entry.tool.sensitivity,
    };
  } catch (error) {
    // A known error is the same however often the call repeats, so the model gets to read it.
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      return {text: error.message, isError: true, sensitivity: entry.tool.sensitivity};
    }
    if (isWrite && params.lastAttempt) {
      // No retry is left to find the recorded start, and the write may have gone through.
      reportError(error, {boundary: 'agent.conversation.tool_call'});
      return UNFINISHED_WRITE_OUTPUT;
    }
    throw error;
  }
}

/**
 * Shows an integration conversation's tool call on its surface, when the provider can. The call
 * is more useful than the status, so a failure here is logged and the call goes on.
 */
async function reportToolProgress(params: {
  conversation: Conversation;
  label: string;
  integrations: IntegrationsModuleClient;
}): Promise<void> {
  const {conversation} = params;
  if (
    conversation.originKind !== 'integration' ||
    conversation.originConnectionId === null ||
    conversation.originKey === null
  ) {
    return;
  }
  try {
    await params.integrations.reportInteractionProgress({
      workspaceId: conversation.workspaceId,
      connectionId: conversation.originConnectionId,
      conversationKey: conversation.originKey,
      state: 'working',
      detail: params.label,
    });
  } catch (error) {
    logger().warn({err: error, conversationId: conversation.id}, 'Failed to report tool progress');
  }
}

/** Stores the result of a call on the timeline, unless a concurrent attempt stored one first. */
async function storeToolResult(params: {
  conversation: Conversation;
  position: {turnId: string; modelCallIndex: number; callIndex: number};
  call: RequestedToolCall;
  output: ToolOutput;
}): Promise<ToolCallResult> {
  const {conversation, position, call, output} = params;
  const itemId = await newConversationRecordId();
  const appended = await appendTurnEntry({
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
          outcome: output.outcome,
        }),
      }),
      meta: {
        role: 'toolResult',
        tool_call_id: call.id,
        tool_name: call.name,
        ...(output.isError ? {is_error: true} : {}),
        ...(output.outcome === undefined ? {} : {outcome: output.outcome}),
      },
    },
  });
  if (!appended) throw new TurnFailure('internal_error', 'The turn ended before its result', false);
  // A concurrent attempt may have stored first, and its result is the one the timeline holds.
  if (!appended.stored) {
    conversationToolCallCount.add(1, {sensitivity: output.sensitivity, outcome: 'replayed'});
    return {status: appended.item.meta.is_error ? 'error' : 'success'};
  }
  conversationToolCallCount.add(1, {
    sensitivity: output.sensitivity,
    outcome: output.outcome ?? (output.isError ? 'error' : 'success'),
  });
  return {status: output.isError ? 'error' : 'success'};
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

  await reportToolProgress({conversation, label: call.name, integrations: params.integrations});

  let output: ToolOutput;
  try {
    output = await executeTool({
      conversation,
      turnId: params.turnId,
      call,
      modelCallIndex: params.modelCallIndex,
      callIndex: params.callIndex,
      integrations: params.integrations,
      definitions: params.definitions,
      lastAttempt: params.lastAttempt,
    });
  } catch (error) {
    if (!params.lastAttempt) throw error;
    reportError(error, {boundary: 'agent.conversation.tool_call'});
    output = {text: 'The tool failed to run', isError: true, sensitivity: 'unknown'};
  }

  return await storeToolResult({conversation, position, call, output});
}
