import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {logger} from '@shipfox/node-opentelemetry';
import {type AgentAccessToolCallOutcome, recordAgentAccessToolCall} from '#metrics/index.js';

export type AgentAccessAuthorityOutcome =
  | 'ok'
  | 'grant-revoked'
  | 'user-inactive'
  | 'membership-revoked'
  | 'workspace-suspended'
  | 'workspace-deleted'
  | 'not-checked'
  | 'dependency-failed';

export interface AgentAccessActionAudit {
  kind: string;
  target: Record<string, unknown>;
  mode?: string | undefined;
  expected_attempt?: number | undefined;
  inputs_supplied: boolean;
  idempotency_key: boolean;
  deduplicated?: boolean | undefined;
  result_run_id?: string | undefined;
  result_attempt?: number | undefined;
  authority_outcome: AgentAccessAuthorityOutcome;
}

export interface AgentAccessToolCallAuditRecord {
  tool: string;
  outcome: AgentAccessToolCallOutcome;
  errorCode: string;
  context: AgentAccessContext;
  action?: AgentAccessActionAudit | undefined;
}

export type AgentAccessToolCallRecorder = (record: AgentAccessToolCallAuditRecord) => void;

export interface CreateAgentAccessToolCallRecorderOptions {
  recordMetric?: typeof recordAgentAccessToolCall;
  logInfo?:
    | ((context: Record<string, unknown>, message: 'agent access tool call audited') => void)
    | undefined;
}

export function createAgentAccessToolCallRecorder(
  options: CreateAgentAccessToolCallRecorderOptions = {},
): AgentAccessToolCallRecorder {
  const recordMetric = options.recordMetric ?? recordAgentAccessToolCall;
  const logInfo = options.logInfo ?? ((context, message) => logger().info(context, message));

  return (record) => {
    recordMetric({tool: record.tool, outcome: record.outcome});
    logInfo(auditLogContext(record), 'agent access tool call audited');
  };
}

function auditLogContext(record: AgentAccessToolCallAuditRecord): Record<string, unknown> {
  const credential = record.context.credential;
  return {
    tool: record.tool,
    outcome: record.outcome,
    errorCode: record.errorCode,
    userId: record.context.userId,
    workspaceId: record.context.workspaceId,
    credentialKind: credential.kind,
    credentialId: credential.grantId,
    clientId: credential.clientId,
    ...(record.action === undefined ? {} : {action: record.action}),
  };
}
