import {
  type AgentAccessEnvelopeDto,
  type AgentAccessObjectSchema,
  agentAccessOutputSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {AGENT_ACCESS_FIXTURE_TOOL_NAME} from '#constants.js';
import {agentAccessError, agentAccessSuccess} from './envelope.js';

export interface AgentAccessToolCall {
  context: AgentAccessContext;
  arguments: Record<string, unknown>;
}

export type AgentAccessAuthorityOutcome =
  | 'ok'
  | 'grant-revoked'
  | 'user-inactive'
  | 'membership-revoked'
  | 'workspace-suspended'
  | 'workspace-deleted'
  | 'not-checked';

export interface AgentAccessActionAudit {
  kind: string;
  target?: Record<string, unknown> | undefined;
  mode?: string | undefined;
  expected_attempt?: number | undefined;
  inputs_supplied?: boolean | undefined;
  idempotency_key_present?: boolean | undefined;
  deduplicated?: boolean | undefined;
  result_run_id?: string | undefined;
  result_attempt?: number | undefined;
  authority_outcome?: AgentAccessAuthorityOutcome | undefined;
}

export interface AgentAccessActionAuditParams {
  input: Record<string, unknown>;
  result?: AgentAccessEnvelopeDto | undefined;
  authorityOutcome: AgentAccessAuthorityOutcome;
}

export type AgentAccessActionAuditFactory = (
  params: AgentAccessActionAuditParams,
) => AgentAccessActionAudit;

export interface AgentAccessTool {
  name: string;
  description: string;
  inputSchema: AgentAccessObjectSchema;
  outputSchema: AgentAccessObjectSchema;
  validateInput?: ((input: unknown) => boolean) | undefined;
  annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint?: boolean | undefined;
    readonly idempotentHint?: boolean | undefined;
    readonly openWorldHint?: boolean | undefined;
  };
  execute: (call: AgentAccessToolCall) => Promise<AgentAccessEnvelopeDto> | AgentAccessEnvelopeDto;
  validateResult?: ((result: unknown) => boolean) | undefined;
  actionAudit?: AgentAccessActionAuditFactory | undefined;
}

export type AgentAccessToolMap = ReadonlyMap<string, AgentAccessTool>;

export function createAgentAccessToolMap(tools: readonly AgentAccessTool[]): AgentAccessToolMap {
  const table = new Map<string, AgentAccessTool>();
  for (const tool of tools) {
    if (table.has(tool.name)) throw new Error(`Duplicate agent-access tool: ${tool.name}`);
    table.set(tool.name, tool);
  }
  return table;
}

/** A deterministic tool used by gateway contract tests; no production tool is registered here. */
export function createAgentAccessFixtureTool(): AgentAccessTool {
  return {
    name: AGENT_ACCESS_FIXTURE_TOOL_NAME,
    description: 'Return a deterministic response from the dormant agent-access gateway fixture.',
    inputSchema: {
      type: 'object',
      properties: {message: {type: 'string', maxLength: 256}},
      required: ['message'],
      additionalProperties: false,
    },
    outputSchema: agentAccessOutputSchema({
      type: 'object',
      properties: {message: {type: 'string'}},
      required: ['message'],
      additionalProperties: false,
    }),
    annotations: {readOnlyHint: true},
    execute: ({arguments: input}) => {
      const message = input.message;
      if (
        Object.keys(input).some((key) => key !== 'message') ||
        typeof message !== 'string' ||
        [...message].length > 256
      ) {
        return agentAccessError('invalid-request', {
          message: 'message must be a string of at most 256 characters with no extra properties',
        });
      }
      return agentAccessSuccess({message});
    },
  };
}

/** A dormant action fixture used to test dispatcher ordering without shipping a production action. */
export function createAgentAccessFixtureActionTool(events: string[] = []): AgentAccessTool {
  return {
    name: 'agent_access_action_fixture',
    description: 'Return a deterministic response from the dormant action fixture.',
    inputSchema: {
      type: 'object',
      properties: {value: {type: 'string', maxLength: 256}},
      required: ['value'],
      additionalProperties: false,
    },
    outputSchema: agentAccessOutputSchema({
      type: 'object',
      properties: {value: {type: 'string'}},
      required: ['value'],
      additionalProperties: false,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    validateInput: (input) => {
      events.push('validateInput');
      return (
        isRecord(input) &&
        Object.keys(input).length === 1 &&
        typeof input.value === 'string' &&
        [...input.value].length <= 256
      );
    },
    actionAudit: ({result, authorityOutcome}) => ({
      kind: 'fixture',
      target: {value: 'fixture'},
      inputs_supplied: true,
      authority_outcome: authorityOutcome,
      ...(result?.ok && isRecord(result.result) && typeof result.result.value === 'string'
        ? {result_run_id: result.result.value}
        : {}),
    }),
    execute: ({arguments: input}) => {
      events.push('producer');
      return agentAccessSuccess({value: input.value});
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
