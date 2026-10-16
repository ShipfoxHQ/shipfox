import type {
  EvaluationTraceDto,
  StepAttemptDto,
  StepErrorDto,
  StepGateRestartDecisionDto,
  StepGateResultDto,
  StepGateResultSummaryDto,
  StepSourceLocationDto,
  WorkflowExecutionEventDto,
} from '@shipfox/api-workflows-dto';
import type {
  EvaluationTraceEntry,
  EvaluationTraceError,
  StepError,
  StepGateRestartDecision,
  StepGateResult,
  StepSourceLocation,
  WorkflowExecutionEvent,
} from '#core/workflow-run.js';

export function toStepSourceLocation(dto: StepSourceLocationDto | null): StepSourceLocation | null {
  if (dto === null) return null;
  return {
    startLine: dto.start_line,
    endLine: dto.end_line,
    ...(dto.file === undefined ? {} : {file: {...dto.file}}),
  };
}

export function toWorkflowJobStepError(dto: StepErrorDto): StepError | null {
  if (dto === null) return null;
  return {
    message: dto.message,
    ...(dto.code === undefined ? {} : {code: dto.code}),
    ...(dto.managed_provider_id === undefined ? {} : {managedProviderId: dto.managed_provider_id}),
    ...(dto.notice === undefined ? {} : {notice: dto.notice}),
    ...(dto.field === undefined ? {} : {field: dto.field}),
    ...(dto.source === undefined ? {} : {source: dto.source}),
    exitCode: dto.exit_code ?? null,
    signal: dto.signal,
    reason: dto.reason,
    agentConfigIssue: dto.agent_config_issue,
    category: dto.category,
    ...(dto.retryable === undefined ? {} : {retryable: dto.retryable}),
    ...(dto.attempt_count === undefined ? {} : {attemptCount: dto.attempt_count}),
    ...(dto.max_attempts === undefined ? {} : {maxAttempts: dto.max_attempts}),
    ...(dto.restart_from === undefined ? {} : {restartFrom: dto.restart_from}),
    ...(dto.provider_message === undefined ? {} : {providerMessage: dto.provider_message}),
  };
}

export function toWorkflowJobGateResult(dto: StepGateResultSummaryDto): StepGateResult {
  if (dto === null) return null;
  if (dto.kind === 'unknown') return {kind: 'unknown', data: {}};
  if (dto.kind === 'not_evaluated') return {kind: dto.kind};
  if (dto.kind === 'none') return {kind: dto.kind, ...toRestartField(dto.restart)};
  if (dto.kind === 'passed' && 'source' in dto) {
    return {kind: 'passed', passed: true, source: dto.source, exitCode: dto.exit_code};
  }
  if (dto.kind === 'failed' && 'source' in dto) {
    return {
      kind: 'failed',
      passed: false,
      source: dto.source,
      exitCode: dto.exit_code,
      ...toRestartField(dto.restart),
    };
  }
  if (dto.kind === 'uncheckable' && 'uncheckable' in dto) {
    return {
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: dto.reason,
      ...(dto.source === undefined ? {} : {source: dto.source}),
      exitCode: dto.exit_code,
    };
  }
  if (dto.kind === 'evaluation_error' && 'reason' in dto) {
    return {kind: 'evaluation_error', reason: dto.reason, exitCode: dto.exit_code};
  }
  return {kind: 'unknown', data: {}};
}

function toRestartField(
  dto: StepGateRestartDecisionDto | undefined,
): {restart: StepGateRestartDecision} | Record<string, never> {
  if (dto === undefined) return {};
  const ruleCount = dto.rule_count === undefined ? {} : {ruleCount: dto.rule_count};
  const trace = dto.trace === undefined ? {} : {trace: toEvaluationTrace(dto.trace) ?? []};
  switch (dto.kind) {
    case 'restart':
      return {
        restart: {
          kind: dto.kind,
          rule: dto.rule,
          ...ruleCount,
          restartFrom: dto.restart_from,
          ...trace,
        },
      };
    case 'none_applied':
      return {restart: {kind: dto.kind, ...ruleCount, ...trace}};
    case 'evaluation_failed':
      return {
        restart: {
          kind: dto.kind,
          rule: dto.rule,
          ...ruleCount,
          source: dto.source,
          ...(dto.error === undefined ? {} : {error: dto.error}),
          ...trace,
        },
      };
  }
}

export function toStepAttemptInvocation(invocation: StepAttemptDto['invocations'][number]) {
  return {
    callIndex: invocation.call_index,
    startedAt: invocation.started_at,
    ...(invocation.finished_at === undefined ? {} : {finishedAt: invocation.finished_at}),
    ...(invocation.outcome === undefined ? {} : {outcome: invocation.outcome}),
    ...(invocation.error_code === undefined ? {} : {errorCode: invocation.error_code}),
    ...(invocation.duration_ms === undefined ? {} : {durationMs: invocation.duration_ms}),
    ...(invocation.next_due_at === undefined ? {} : {nextDueAt: invocation.next_due_at}),
  };
}

export function toWorkflowExecutionEvent(dto: WorkflowExecutionEventDto): WorkflowExecutionEvent {
  return {
    source: dto.source,
    event: dto.event,
    deliveryId: dto.delivery_id,
    receivedAt: dto.received_at,
    project: dto.project,
    repository: dto.repository,
    ref: dto.ref,
    commit: dto.commit,
    data: dto.data,
  };
}

export function toStepGateResult(dto: StepGateResultDto): StepGateResult {
  if (dto === null || dto.kind === 'not_evaluated') return dto;
  if (dto.kind === 'none') return {kind: dto.kind, ...toRestartField(dto.restart)};
  if (dto.kind === 'passed') return {...dto, exitCode: dto.exit_code};
  if (dto.kind === 'failed') {
    const {restart, ...failed} = dto;
    return {...failed, exitCode: dto.exit_code, ...toRestartField(restart)};
  }
  if (dto.kind === 'uncheckable') {
    return {
      kind: dto.kind,
      passed: dto.passed,
      uncheckable: dto.uncheckable,
      reason: dto.reason,
      ...(dto.source === undefined ? {} : {source: dto.source}),
      exitCode: dto.exit_code,
    };
  }
  if (dto.kind === 'evaluation_error') {
    return {kind: dto.kind, reason: dto.reason, exitCode: dto.exit_code};
  }
  return dto;
}

export function toEvaluationTrace(trace: EvaluationTraceDto | null): EvaluationTraceEntry[] | null {
  return trace?.map(toEvaluationTraceEntry) ?? null;
}

function toEvaluationTraceEntry(entry: EvaluationTraceDto[number]): EvaluationTraceEntry {
  if ('dropped' in entry) return entry;
  return {
    expression: entry.expression,
    roots: entry.roots,
    fillTarget: entry.fill_target,
    evaluatedAt: entry.evaluated_at,
    field: entry.field,
    ...(entry.value === undefined ? {} : {value: entry.value}),
    ...(entry.truncated === undefined ? {} : {truncated: entry.truncated}),
    ...(entry.expr_truncated === undefined ? {} : {exprTruncated: entry.expr_truncated}),
    ...(entry.reference === undefined ? {} : {reference: entry.reference}),
    ...(entry.degraded === undefined ? {} : {degraded: entry.degraded}),
    ...(entry.error === undefined ? {} : {error: toEvaluationTraceError(entry.error)}),
    ...(entry.env_key === undefined ? {} : {envKey: entry.env_key}),
  };
}

function toEvaluationTraceError(
  error: NonNullable<Extract<EvaluationTraceDto[number], {expression: string}>['error']>,
): EvaluationTraceError {
  return {
    message: error.message,
    ...(error.path === undefined ? {} : {path: error.path}),
    ...(error.source === undefined ? {} : {source: error.source}),
  };
}

export function recordConfigValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
