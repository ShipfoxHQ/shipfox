import type {WorkflowExpressionEvaluationContext} from '@shipfox/expression';
import type {JobExecution} from '#core/entities/job-execution.js';
import type {Step, StepAttempt, StepStatus} from '#core/entities/step.js';
import type {TriggerPayload, WorkflowRun} from '#core/entities/workflow-run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export interface AssembleWorkflowRunContextParams {
  readonly run: Pick<
    WorkflowRun,
    'id' | 'name' | 'definitionId' | 'projectId' | 'workspaceId' | 'createdAt'
  >;
  readonly triggerPayload: TriggerPayload;
  readonly inputs?: Record<string, unknown> | null | undefined;
  readonly vars?: Record<string, string> | undefined;
}

export function assembleWorkflowRunContext(
  params: AssembleWorkflowRunContextParams,
): WorkflowExpressionEvaluationContext {
  return {
    run: {
      id: params.run.id,
      name: params.run.name,
      definition_id: params.run.definitionId,
      project_id: params.run.projectId,
      workspace_id: params.run.workspaceId,
      created_at: params.run.createdAt,
    },
    trigger: {
      source: params.triggerPayload.source,
      event: params.triggerPayload.event,
    },
    event: 'data' in params.triggerPayload ? params.triggerPayload.data : null,
    inputs: params.inputs ?? null,
    ...(params.vars === undefined ? {} : {vars: params.vars}),
  };
}

export function assembleCreationContext(
  params: AssembleWorkflowRunContextParams,
): WorkflowEvaluationContext {
  return {
    site: 'run-creation',
    values: assembleWorkflowRunContext(params),
  };
}

export interface AssembleExecutionCreationContextParams extends AssembleWorkflowRunContextParams {
  readonly jobId: string;
  readonly sequence: number;
  readonly executionName: string;
  readonly status: JobExecution['status'];
  readonly triggerEvents: readonly JobExecution['triggerEvents'][number][];
  readonly priorExecutions: readonly JobExecution[];
}

export function assembleExecutionCreationContext(
  params: AssembleExecutionCreationContextParams,
): WorkflowEvaluationContext {
  const execution: JobExecution = {
    id: `${params.jobId}:${params.sequence}`,
    jobId: params.jobId,
    sequence: params.sequence,
    name: params.executionName,
    runner: null,
    status: params.status,
    statusReason: null,
    triggerEvents: [...params.triggerEvents],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    timedOutAt: null,
  };
  const executions = assembleExecutionsContext([...params.priorExecutions, execution]);
  const executionValues = executions.executions as unknown[];
  return {
    site: 'execution-creation',
    values: {
      ...assembleWorkflowRunContext(params),
      ...executions,
      execution: executionValues.at(-1),
    },
  };
}

/**
 * Keeps job-success predicate values aligned with the registry's `executions`
 * type environment.
 */
export function assembleExecutionsContext(
  executions: readonly JobExecution[],
): WorkflowExpressionEvaluationContext {
  return {
    executions: executions.map((execution, index) => ({
      index,
      name: execution.name,
      status: execution.status,
      started_at: execution.startedAt,
      finished_at: execution.finishedAt,
      events: execution.triggerEvents,
    })),
  };
}

export function assembleStepDispatchContext(params: {
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly targetStepId: string;
  readonly jobExecution?: JobExecution;
}): WorkflowEvaluationContext {
  const stepsByKey = new Map(
    params.steps.flatMap((step) => (step.key === null ? [] : [[step.key, step] as const])),
  );
  const terminalAttemptsByStepId = new Map<string, StepAttempt[]>();
  const orderedAttempts = [...params.attempts].sort(
    (left, right) => left.executionOrder - right.executionOrder,
  );

  for (const attempt of orderedAttempts) {
    if (attempt.status === 'running') continue;
    const attemptsForStep = terminalAttemptsByStepId.get(attempt.stepId) ?? [];
    attemptsForStep.push(attempt);
    terminalAttemptsByStepId.set(attempt.stepId, attemptsForStep);
  }

  const stepsContext: Record<string, Record<string, unknown>> = {};

  for (const step of params.steps) {
    if (step.key === null) continue;
    const attempts = terminalAttemptsByStepId.get(step.id) ?? [];
    const latestAttempt = attempts.at(-1);
    stepsContext[step.key] = {
      status: step.status,
      ...(latestAttempt === undefined ? {} : latestAttemptFields(latestAttempt)),
      attempts: attempts.map(attemptFields),
    };
  }

  const targetStep = params.steps.find((step) => step.id === params.targetStepId);
  const restart =
    targetStep === undefined || targetStep.currentAttempt <= 1
      ? undefined
      : restartProvenance({
          targetStep,
          orderedAttempts,
          stepsByKey,
          terminalAttemptsByStepId,
        });

  return {
    site: 'step-dispatch',
    values: {
      ...(params.jobExecution === undefined
        ? {}
        : {
            execution: {
              index: params.jobExecution.sequence,
              name: params.jobExecution.name,
              status: params.jobExecution.status,
              started_at: params.jobExecution.startedAt,
              finished_at: params.jobExecution.finishedAt,
              events: params.jobExecution.triggerEvents,
            },
          }),
      ...(targetStep === undefined
        ? {}
        : {
            step: {
              attempt: BigInt(targetStep.currentAttempt),
              is_retry: targetStep.currentAttempt > 1,
              ...(restart === undefined ? {} : {restart}),
            },
          }),
      steps: stepsContext,
    },
  };
}

function restartProvenance(params: {
  readonly targetStep: Step;
  readonly orderedAttempts: readonly StepAttempt[];
  readonly stepsByKey: ReadonlyMap<string, Step>;
  readonly terminalAttemptsByStepId: ReadonlyMap<string, readonly StepAttempt[]>;
}): Record<string, unknown> | undefined {
  for (const attempt of [...params.orderedAttempts].reverse()) {
    if (attempt.status !== 'failed' || attempt.restartFeedback === null) continue;
    const restartFromKey = restartFromStepKey(attempt);
    if (restartFromKey === undefined) continue;

    const restartFromStep = params.stepsByKey.get(restartFromKey);
    if (restartFromStep === undefined || restartFromStep.position > params.targetStep.position) {
      continue;
    }

    const gatingAttempts = params.terminalAttemptsByStepId.get(attempt.stepId) ?? [];
    return {
      from: {
        ...attemptFields(attempt),
        attempts: gatingAttempts.map(attemptFields),
      },
      feedback: attempt.restartFeedback,
    };
  }

  return undefined;
}

function restartFromStepKey(attempt: StepAttempt): string | undefined {
  const gate = attempt.config?.gate;
  if (gate === null || typeof gate !== 'object') return undefined;
  const onFailure = (gate as Record<string, unknown>).on_failure;
  if (onFailure === null || typeof onFailure !== 'object') return undefined;
  const restartFrom = (onFailure as Record<string, unknown>).restart_from;
  return typeof restartFrom === 'string' ? restartFrom : undefined;
}

function attemptFields(attempt: StepAttempt): Record<string, unknown> {
  return {
    status: attempt.status,
    outputs: attempt.output ?? {},
    ...(attempt.exitCode === null ? {} : {exit_code: BigInt(attempt.exitCode)}),
    ...(attempt.gateResult === null ? {} : {gate: attempt.gateResult}),
  };
}

function latestAttemptFields(attempt: StepAttempt): Record<string, unknown> {
  const fields = attemptFields(attempt);
  delete fields.status;
  return fields;
}

export function assembleGateContext(params: {
  readonly status: StepStatus;
  readonly exitCode: number | null;
  readonly output?: Record<string, unknown> | null | undefined;
}): WorkflowEvaluationContext {
  return {
    site: 'step-report',
    values: {
      step: {
        ...(params.exitCode === null ? {} : {exit_code: BigInt(params.exitCode)}),
        status: params.status,
        outputs: params.output ?? {},
      },
    },
  };
}

export function assembleJobResolutionContext(
  executions: readonly JobExecution[],
): WorkflowEvaluationContext {
  return {
    site: 'job-resolution',
    values: assembleExecutionsContext(executions),
  };
}
