import type {WorkflowModel} from '@shipfox/api-definitions';
import {
  freezePlannedRunCommandAtSite,
  getWorkflowInterpolationFieldFailurePolicy,
  hoistPlannedRunCommand,
  type ResolvedField,
  UnsafeRunInterpolationError,
} from '@shipfox/expression';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {
  completeStepField,
  resolveStepField,
  stepConfigInterpolationError,
  type WorkflowStepTemplateDiagnostic,
} from './fields.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelRunStep = Extract<WorkflowModelStep, {kind: 'run'}>;

export type StepConfigMode = 'effective' | 'authored';

interface WinningEnvValue {
  readonly value: string;
  readonly template?: ResolvedField['segments'];
}

export interface ResolveRunStepConfigParams {
  readonly step: WorkflowModelRunStep;
  readonly workflowEnv: WorkflowModel['env'];
  readonly workflowEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly jobEnv: WorkflowModelJob['env'];
  readonly jobEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly definitionId: string;
}

type WorkflowEnvTemplates = Readonly<Record<string, ResolvedField['segments']>>;

export interface RunStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
}

export function resolveRunStepConfig(params: ResolveRunStepConfigParams): RunStepConfig {
  const env = winningEnv(params);
  const envResolution = resolveEnv(env, params.context, params.mode, params.definitionId);
  const commandResolution = resolveCommand({
    step: params.step,
    envKeys: Object.keys(envResolution.env),
    context: params.context,
    mode: params.mode,
    definitionId: params.definitionId,
  });
  const mergedEnv = {...envResolution.env, ...commandResolution.env};
  const hasEnvConfig = Object.keys(mergedEnv).length > 0;
  const envConfig = hasEnvConfig ? {env: mergedEnv} : {};
  const planEnv = {...envResolution.configPlan, ...commandResolution.configPlan};
  const hasConfigPlan = Object.keys(planEnv).length > 0;
  const configPlan = hasConfigPlan ? ({env: planEnv} satisfies StepConfigDispatchPlan) : null;
  const hasTemplates = envResolution.hasTemplates || commandResolution.hasTemplate;

  return {
    config: {run: commandResolution.command, ...envConfig},
    configPlan,
    diagnostics: [...envResolution.diagnostics, ...commandResolution.diagnostics],
    hasTemplates,
  };
}

export function completeRunDispatchConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
}): void {
  const env = {...readConfigEnv(params.config)};

  if (params.plan.run !== undefined) {
    const resolved = freezePlannedRunCommandAtSite({
      field: params.plan.run,
      site: params.context.site,
      context: params.context.values,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy('run'),
      reservedNames: Object.keys(env),
    });
    params.config.run = resolved.command;
    Object.assign(env, resolved.env);
  }

  if (params.plan.env !== undefined) {
    for (const [key, field] of Object.entries(params.plan.env)) {
      env[key] = completeStepField({
        field: 'env.value',
        errorField: 'env',
        template: field,
        context: params.context,
        definitionId: params.definitionId,
        envKey: key,
      });
    }
  }

  if (Object.keys(env).length > 0) params.config.env = env;
}

function resolveCommand(params: {
  readonly step: WorkflowModelRunStep;
  readonly envKeys: readonly string[];
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly definitionId: string;
}): {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly configPlan: Readonly<Record<string, ResolvedField>>;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplate: boolean;
} {
  const template = params.step.templates?.command;
  const hasTemplate = template !== undefined;
  if (!hasTemplate) {
    return {
      command: params.step.command.value,
      env: {},
      configPlan: {},
      diagnostics: [],
      hasTemplate: false,
    };
  }

  const usesAuthoredMode = params.mode === 'authored';
  if (usesAuthoredMode) {
    return {
      command: params.step.command.value,
      env: {},
      configPlan: {},
      diagnostics: [],
      hasTemplate: true,
    };
  }

  const env: Record<string, string> = {};
  const configPlan: Record<string, ResolvedField> = {};
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const hoisted = hoistCommand(template, params.envKeys, params.definitionId);

  for (const binding of hoisted.bindings) {
    const resolved = resolveStepField({
      field: 'run',
      template: {segments: [binding.segment]},
      context: params.context,
      definitionId: params.definitionId,
      errorField: 'run',
    });
    const resolvedToDispatchPlan = resolved.kind === 'residual';
    if (resolvedToDispatchPlan) configPlan[binding.name] = resolved.field;
    else env[binding.name] = resolved.value;
    diagnostics.push(
      ...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: 'run' as const})),
    );
  }

  return {
    command: hoisted.command,
    env,
    configPlan,
    diagnostics,
    hasTemplate: true,
  };
}

function hoistCommand(
  template: ResolvedField['segments'],
  reservedNames: readonly string[],
  definitionId: string,
): ReturnType<typeof hoistPlannedRunCommand> {
  try {
    return hoistPlannedRunCommand({
      field: {segments: template},
      reservedNames,
    });
  } catch (error) {
    if (error instanceof UnsafeRunInterpolationError) {
      throw stepConfigInterpolationError({definitionId, errorField: 'run'}, error);
    }
    throw error;
  }
}

function resolveEnv(
  env: Readonly<Record<string, WinningEnvValue>>,
  context: WorkflowEvaluationContext,
  mode: StepConfigMode,
  definitionId: string,
): {
  readonly env: Readonly<Record<string, string>>;
  readonly configPlan: Readonly<Record<string, ResolvedField>>;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
} {
  const resolvedEnv: Record<string, string> = {};
  const configPlan: Record<string, ResolvedField> = {};
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  let hasTemplates = false;

  for (const [key, entry] of Object.entries(env)) {
    const template = entry.template;
    const hasTemplate = template !== undefined;
    const usesAuthoredMode = mode === 'authored';
    const shouldUseAuthoredValue = !hasTemplate || usesAuthoredMode;

    if (shouldUseAuthoredValue) {
      resolvedEnv[key] = entry.value;
      hasTemplates ||= hasTemplate;
      continue;
    }

    hasTemplates = true;
    const resolved = resolveStepField({
      field: 'env.value',
      template: {segments: template},
      context,
      definitionId,
      errorField: 'env',
      envKey: key,
    });
    const resolvedToDispatchPlan = resolved.kind === 'residual';
    if (resolvedToDispatchPlan) configPlan[key] = resolved.field;
    else resolvedEnv[key] = resolved.value;
    diagnostics.push(
      ...resolved.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        field: 'env' as const,
        envKey: key,
      })),
    );
  }

  return {env: resolvedEnv, configPlan, diagnostics, hasTemplates};
}

function winningEnv(params: {
  readonly workflowEnv: WorkflowModel['env'];
  readonly workflowEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly jobEnv: WorkflowModelJob['env'];
  readonly jobEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly step: WorkflowModelStep;
}): Readonly<Record<string, WinningEnvValue>> {
  if (params.step.kind !== 'run') return {};

  return mergeEnvLayers(
    {env: params.workflowEnv, templates: params.workflowEnvTemplates},
    {env: params.jobEnv, templates: params.jobEnvTemplates},
    {env: params.step.env, templates: params.step.templates?.env},
  );
}

function mergeEnvLayers(
  ...layers: readonly {
    readonly env: Readonly<Record<string, string>> | undefined;
    readonly templates: WorkflowEnvTemplates | undefined;
  }[]
): Readonly<Record<string, WinningEnvValue>> {
  const merged: Record<string, WinningEnvValue> = {};

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.env ?? {})) {
      const template = layer.templates?.[key];
      const hasTemplate = template !== undefined;
      merged[key] = hasTemplate ? {value, template} : {value};
    }
  }

  return merged;
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
