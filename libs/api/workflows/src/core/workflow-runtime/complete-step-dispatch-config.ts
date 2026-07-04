import {
  InvalidAgentModelError,
  UnsupportedModelProviderError,
} from '@shipfox/api-agent/core/errors';
import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {AgentThinking} from '@shipfox/api-agent-dto';
import {
  freezePlannedRunCommandAtSite,
  getWorkflowInterpolationFieldFailurePolicy,
  resolveFieldAtSite,
  type WorkflowExpressionEvaluationContext,
  type WorkflowInterpolationField,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import type {JobExecution} from '#core/entities/job-execution.js';
import type {Step, StepAttempt, StepConfigDispatchPlan} from '#core/entities/step.js';
import {
  AgentConfigUnresolvableError,
  InterpolationUnresolvableError,
  type InterpolationUnresolvableField,
} from '#core/errors.js';

export function assembleStepDispatchContext(params: {
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly targetStepId: string;
  readonly jobExecution?: JobExecution;
}): WorkflowExpressionEvaluationContext {
  const attemptsByStepId = new Map(
    params.attempts
      .filter((attempt) => attempt.status !== 'running')
      .map((attempt) => [attempt.stepId, attempt]),
  );
  const stepsContext: Record<string, {outputs: Record<string, unknown>}> = {};

  for (const step of params.steps) {
    if (step.id === params.targetStepId || step.key === null) continue;
    const attempt = attemptsByStepId.get(step.id);
    if (attempt === undefined) continue;
    stepsContext[step.key] = {outputs: attempt.output ?? {}};
  }

  return {
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
    steps: stepsContext,
  };
}

export function completeStepDispatchConfig(params: {
  readonly step: Step;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly resolveAgentDefaults: AgentDefaultsResolver;
  readonly definitionId: string;
}): Record<string, unknown> {
  const plan = params.step.configPlan;
  if (plan === null) return params.step.config;

  const config = {...params.step.config};
  const env = {...readConfigEnv(config)};

  if (plan.run !== undefined) {
    const resolved = freezePlannedRunCommandAtSite({
      field: plan.run,
      site: 'step-dispatch',
      context: params.context,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy('run'),
      reservedNames: Object.keys(env),
    });
    config.run = resolved.command;
    Object.assign(env, resolved.env);
  }

  if (plan.env !== undefined) {
    for (const [key, field] of Object.entries(plan.env)) {
      env[key] = completeField({
        field: 'env.value',
        errorField: 'env',
        template: field,
        context: params.context,
        definitionId: params.definitionId,
        envKey: key,
      });
    }
  }

  if (Object.keys(env).length > 0) config.env = env;
  completeAgentConfig({
    config,
    plan,
    context: params.context,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
  });

  return config;
}

function completeAgentConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly resolveAgentDefaults: AgentDefaultsResolver;
  readonly definitionId: string;
}): void {
  const agent = params.plan.agent;
  if (agent === undefined) return;

  const prompt =
    agent.prompt === undefined
      ? readConfigString(params.config, 'prompt')
      : completeField({
          field: 'agent.prompt',
          errorField: 'agent.prompt',
          template: agent.prompt,
          context: params.context,
          definitionId: params.definitionId,
        });
  const model =
    agent.model === undefined
      ? readConfigString(params.config, 'model')
      : completeField({
          field: 'agent.model',
          errorField: 'agent.model',
          template: agent.model,
          context: params.context,
          definitionId: params.definitionId,
        });
  const provider =
    agent.provider === undefined
      ? readConfigString(params.config, 'provider')
      : completeField({
          field: 'agent.provider',
          errorField: 'agent.provider',
          template: agent.provider,
          context: params.context,
          definitionId: params.definitionId,
        });

  try {
    const defaults = params.resolveAgentDefaults({
      provider,
      model,
      thinking: agent.thinking ?? readConfigThinking(params.config),
    });
    params.config.provider = defaults.provider;
    params.config.model = defaults.model;
    params.config.thinking = defaults.thinking;
    params.config.prompt = prompt;
  } catch (error) {
    if (error instanceof UnsupportedModelProviderError || error instanceof InvalidAgentModelError) {
      throw new AgentConfigUnresolvableError(params.definitionId, {cause: error});
    }
    throw error;
  }
}

function completeField(params: {
  readonly field: WorkflowInterpolationField;
  readonly errorField: InterpolationUnresolvableField;
  readonly template: StepConfigDispatchPlan['run'];
  readonly context: WorkflowExpressionEvaluationContext;
  readonly definitionId: string;
  readonly envKey?: string;
}): string {
  if (params.template === undefined) return '';
  try {
    const resolved = resolveFieldAtSite({
      field: params.template,
      site: 'step-dispatch',
      context: params.context,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    });
    if (resolved.kind === 'frozen') return resolved.value;
    const source = resolved.field.segments.find((segment) => segment.kind === 'deferred')
      ?.expression.source;
    throw new InterpolationUnresolvableError(params.definitionId, {
      field: params.errorField,
      source: source ?? params.field,
      ...(params.envKey === undefined ? {} : {envKey: params.envKey}),
    });
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw new InterpolationUnresolvableError(params.definitionId, {
        field: params.errorField,
        source: error.source,
        ...(params.envKey === undefined ? {} : {envKey: params.envKey}),
        cause: error,
      });
    }
    throw error;
  }
}

function readConfigEnv(config: Record<string, unknown>): Record<string, string> {
  const env = config.env;
  if (env === null || typeof env !== 'object' || Array.isArray(env)) return {};
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
}

function readConfigString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

function readConfigThinking(config: Record<string, unknown>): AgentThinking | undefined {
  const value = config.thinking;
  return value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : undefined;
}
