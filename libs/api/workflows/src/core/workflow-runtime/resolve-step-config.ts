import {
  InvalidAgentModelError,
  UnsupportedModelProviderError,
} from '@shipfox/api-agent/core/errors';
import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {WorkflowEnvTemplates, WorkflowModel} from '@shipfox/api-definitions';
import {
  type AvailabilitySite,
  freezeResolvedFieldAtSite,
  getWorkflowInterpolationFieldFailurePolicy,
  hoistPlannedRunCommand,
  resolveFieldAtSite,
  UnsafeRunInterpolationError,
  type WorkflowExpressionEvaluationContext,
  type WorkflowInterpolationField,
  type WorkflowTemplateDiagnostic,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {
  AgentConfigUnresolvableError,
  InterpolationUnresolvableError,
  type InterpolationUnresolvableField,
} from '#core/errors.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelRunStep = Extract<WorkflowModelStep, {kind: 'run'}>;
type WorkflowModelAgentStep = Extract<WorkflowModelStep, {kind: 'agent'}>;
type WorkflowFieldTemplate = NonNullable<NonNullable<WorkflowModelRunStep['templates']>['command']>;
type StepConfigMode = 'effective' | 'authored';
type FieldResolution =
  | {readonly kind: 'frozen'; readonly value: string}
  | {readonly kind: 'residual'; readonly field: {readonly segments: WorkflowFieldTemplate}};

export type StepConfigField = InterpolationUnresolvableField;

export interface WorkflowStepTemplateDiagnostic extends WorkflowTemplateDiagnostic {
  readonly field: StepConfigField;
  readonly envKey?: string;
}

export interface ResolvedStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly authoredConfig: Record<string, unknown> | null;
  readonly name?: string;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
}

export interface ResolveStepConfigParams {
  readonly step: WorkflowModelStep;
  readonly workflowEnv: WorkflowModel['env'];
  readonly workflowEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly jobEnv: WorkflowModelJob['env'];
  readonly jobEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly resolveAgentDefaults: AgentDefaultsResolver;
  readonly definitionId: string;
}

interface WinningEnvValue {
  readonly value: string;
  readonly template?: WorkflowFieldTemplate;
}

type BuildStepConfigParams = ResolveStepConfigParams & {readonly mode: StepConfigMode};

interface BuiltStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
}

interface AgentFieldResolutions {
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly prompt: FieldResolution;
  readonly model: FieldResolution | undefined;
  readonly provider: FieldResolution | undefined;
  readonly hasTemplates: boolean;
}

export function resolveStepConfig(params: ResolveStepConfigParams): ResolvedStepConfig {
  const effective = buildStepConfig({...params, mode: 'effective'});
  const authoredConfig = effective.hasTemplates
    ? buildStepConfig({...params, mode: 'authored'}).config
    : null;
  const name = resolveStepName(params.step, params.context, params.site, params.definitionId);

  return {
    config: effective.config,
    configPlan: effective.configPlan,
    authoredConfig,
    ...(name.value === undefined || name.value === '' ? {} : {name: name.value}),
    diagnostics: [...effective.diagnostics, ...name.diagnostics],
  };
}

function buildStepConfig(params: BuildStepConfigParams): BuiltStepConfig {
  const gate = gateConfigForStep(params.step);
  const runStep = runStepOrNull(params.step);
  const isRunStep = runStep !== null;

  if (isRunStep) return runStepConfig({...params, step: runStep}, gate);

  const agentStep = agentStepOrNull(params.step);
  if (agentStep === null) throw new Error(`Unsupported workflow step kind: ${params.step.kind}`);

  const agent = agentStepConfig(agentStep, params.context, params);
  return {
    config: {...agent.config, ...gate},
    configPlan: agent.configPlan,
    diagnostics: agent.diagnostics,
    hasTemplates: agent.hasTemplates,
  };
}

function runStepOrNull(step: WorkflowModelStep): WorkflowModelRunStep | null {
  const isRunStep = step.kind === 'run';
  return isRunStep ? step : null;
}

function agentStepOrNull(step: WorkflowModelStep): WorkflowModelAgentStep | null {
  const isAgentStep = step.kind === 'agent';
  return isAgentStep ? step : null;
}

function runStepConfig(
  params: BuildStepConfigParams & {readonly step: WorkflowModelRunStep},
  gate: Record<string, unknown>,
): BuiltStepConfig {
  const env = winningEnv(params);
  const envResolution = resolveEnv(
    env,
    params.context,
    params.site,
    params.mode,
    params.definitionId,
  );
  const commandResolution = resolveCommand({
    step: params.step,
    envKeys: Object.keys(envResolution.env),
    context: params.context,
    site: params.site,
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
    config: {run: commandResolution.command, ...envConfig, ...gate},
    configPlan,
    diagnostics: [...envResolution.diagnostics, ...commandResolution.diagnostics],
    hasTemplates,
  };
}

function gateConfigForStep(step: WorkflowModelStep): Record<string, unknown> {
  const hasGate = step.gate !== undefined;
  return hasGate ? {gate: stepGateConfig(step.gate)} : {};
}

function resolveCommand(params: {
  readonly step: WorkflowModelRunStep;
  readonly envKeys: readonly string[];
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly mode: StepConfigMode;
  readonly definitionId: string;
}): {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly configPlan: Readonly<Record<string, {readonly segments: WorkflowFieldTemplate}>>;
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
  const configPlan: Record<string, {readonly segments: WorkflowFieldTemplate}> = {};
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  let command: string;
  try {
    const hoisted = hoistPlannedRunCommand({
      field: {segments: template},
      reservedNames: params.envKeys,
    });
    command = hoisted.command;

    for (const binding of hoisted.bindings) {
      const resolved = resolveFieldAtSite({
        field: {segments: [binding.segment]},
        context: params.context,
        site: params.site,
        failurePolicy: getWorkflowInterpolationFieldFailurePolicy('run'),
      });
      const resolvedToDispatchPlan = resolved.kind === 'residual';
      if (resolvedToDispatchPlan) configPlan[binding.name] = resolved.field;
      else env[binding.name] = resolved.value;
      diagnostics.push(
        ...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: 'run' as const})),
      );
    }
  } catch (error) {
    const isTemplateError =
      error instanceof UnsafeRunInterpolationError ||
      error instanceof WorkflowTemplateResolutionError;
    if (isTemplateError) {
      throw interpolationError(params.definitionId, 'run', error);
    }
    throw error;
  }

  return {
    command,
    env,
    configPlan,
    diagnostics,
    hasTemplate: true,
  };
}

function resolveEnv(
  env: Readonly<Record<string, WinningEnvValue>>,
  context: WorkflowExpressionEvaluationContext,
  site: AvailabilitySite,
  mode: StepConfigMode,
  definitionId: string,
): {
  readonly env: Readonly<Record<string, string>>;
  readonly configPlan: Readonly<Record<string, {readonly segments: WorkflowFieldTemplate}>>;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
} {
  const resolvedEnv: Record<string, string> = {};
  const configPlan: Record<string, {readonly segments: WorkflowFieldTemplate}> = {};
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
    const resolved = resolveField({
      field: 'env.value',
      template,
      context,
      site,
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

function agentStepConfig(
  step: WorkflowModelAgentStep,
  context: WorkflowExpressionEvaluationContext,
  params: BuildStepConfigParams,
): BuiltStepConfig {
  const fields = resolveAgentFields(step, context, params);
  const usesAuthoredMode = params.mode === 'authored';

  if (usesAuthoredMode) return authoredAgentStepConfig(step, fields);

  const hasDeferredModelOrProvider =
    fields.model?.kind === 'residual' || fields.provider?.kind === 'residual';
  if (hasDeferredModelOrProvider) return deferredAgentStepConfig(step, fields);

  return agentStepConfigWithDefaults(step, params, fields);
}

function resolveAgentFields(
  step: WorkflowModelAgentStep,
  context: WorkflowExpressionEvaluationContext,
  params: BuildStepConfigParams,
): AgentFieldResolutions {
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const prompt = resolveAgentField({
    field: 'agent.prompt',
    value: step.prompt,
    template: step.templates?.prompt,
    context,
    mode: params.mode,
    site: params.site,
    diagnostics,
    definitionId: params.definitionId,
  });
  const model = resolveOptionalAgentField({
    field: 'agent.model',
    value: step.model,
    template: step.templates?.model,
    context,
    mode: params.mode,
    site: params.site,
    diagnostics,
    definitionId: params.definitionId,
  });
  const provider = resolveOptionalAgentField({
    field: 'agent.provider',
    value: step.provider,
    template: step.templates?.provider,
    context,
    mode: params.mode,
    site: params.site,
    diagnostics,
    definitionId: params.definitionId,
  });
  const hasTemplates =
    step.templates?.prompt !== undefined ||
    step.templates?.model !== undefined ||
    step.templates?.provider !== undefined;

  return {diagnostics, prompt, model, provider, hasTemplates};
}

function authoredAgentStepConfig(
  step: WorkflowModelAgentStep,
  fields: AgentFieldResolutions,
): BuiltStepConfig {
  return {
    config: {
      ...(step.provider === undefined ? {} : {provider: step.provider}),
      ...(step.model === undefined ? {} : {model: step.model}),
      ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
      prompt: step.prompt,
    },
    configPlan: null,
    diagnostics: fields.diagnostics,
    hasTemplates: fields.hasTemplates,
  };
}

function deferredAgentStepConfig(
  step: WorkflowModelAgentStep,
  fields: AgentFieldResolutions,
): BuiltStepConfig {
  return {
    config: {},
    configPlan: {
      agent: {
        prompt: dispatchPlanField(fields.prompt),
        ...(fields.model === undefined ? {} : {model: dispatchPlanField(fields.model)}),
        ...(fields.provider === undefined ? {} : {provider: dispatchPlanField(fields.provider)}),
        ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
      },
    },
    diagnostics: fields.diagnostics,
    hasTemplates: fields.hasTemplates,
  };
}

function agentStepConfigWithDefaults(
  step: WorkflowModelAgentStep,
  params: BuildStepConfigParams,
  fields: AgentFieldResolutions,
): BuiltStepConfig {
  const providerValue = frozenFieldValue(fields.provider);
  const modelValue = frozenFieldValue(fields.model);
  const promptIsDeferred = fields.prompt.kind === 'residual';

  try {
    const resolved = params.resolveAgentDefaults({
      provider: providerValue,
      model: modelValue,
      thinking: step.thinking,
    });
    if (promptIsDeferred) {
      return {
        config: {
          provider: resolved.provider,
          model: resolved.model,
          thinking: resolved.thinking,
        },
        configPlan: {
          agent: {
            prompt: dispatchPlanField(fields.prompt),
          },
        },
        diagnostics: fields.diagnostics,
        hasTemplates: fields.hasTemplates,
      };
    }

    const promptValue = frozenFieldValue(fields.prompt) ?? step.prompt;
    return {
      config: {
        provider: resolved.provider,
        model: resolved.model,
        thinking: resolved.thinking,
        prompt: promptValue,
      },
      configPlan: null,
      diagnostics: fields.diagnostics,
      hasTemplates: fields.hasTemplates,
    };
  } catch (error) {
    const isAgentDefaultsError =
      error instanceof UnsupportedModelProviderError || error instanceof InvalidAgentModelError;
    if (isAgentDefaultsError) {
      throw new AgentConfigUnresolvableError(params.definitionId, {cause: error});
    }
    throw error;
  }
}

function dispatchPlanField(field: FieldResolution): {readonly segments: WorkflowFieldTemplate} {
  const isResidual = field.kind === 'residual';
  return isResidual ? field.field : literalField(field.value);
}

function frozenFieldValue(field: FieldResolution | undefined): string | undefined {
  const isFrozen = field?.kind === 'frozen';
  return isFrozen ? field.value : undefined;
}

function resolveAgentField(params: {
  readonly field: Extract<StepConfigField, `agent.${string}`>;
  readonly value: string;
  readonly template: WorkflowFieldTemplate | undefined;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly mode: StepConfigMode;
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly definitionId: string;
}): FieldResolution {
  const hasTemplate = params.template !== undefined;
  const usesAuthoredMode = params.mode === 'authored';
  if (!hasTemplate || usesAuthoredMode) {
    return {kind: 'frozen', value: params.value};
  }

  const resolved = resolveField({
    field: params.field,
    template: params.template,
    context: params.context,
    site: params.site,
    definitionId: params.definitionId,
    errorField: params.field,
  });
  params.diagnostics.push(
    ...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: params.field})),
  );
  const resolvedToDispatchPlan = resolved.kind === 'residual';
  if (resolvedToDispatchPlan) return {kind: 'residual', field: resolved.field};
  return {kind: 'frozen', value: resolved.value};
}

function resolveOptionalAgentField(params: {
  readonly field: Extract<StepConfigField, `agent.${string}`>;
  readonly value: string | undefined;
  readonly template: WorkflowFieldTemplate | undefined;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly mode: StepConfigMode;
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly definitionId: string;
}): FieldResolution | undefined {
  const hasValue = params.value !== undefined;
  if (!hasValue) return undefined;
  return resolveAgentField({...params, value: params.value});
}

function resolveStepName(
  step: WorkflowModelStep,
  context: WorkflowExpressionEvaluationContext,
  site: AvailabilitySite,
  definitionId: string,
): {
  readonly value: string | undefined;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
} {
  const hasName = step.name !== undefined;
  if (!hasName) return {value: undefined, diagnostics: []};

  const hasNameTemplate = step.templates?.name !== undefined;
  if (!hasNameTemplate) return {value: step.name, diagnostics: []};

  const resolved = freezeField({
    field: 'step.name',
    template: step.templates.name,
    context,
    site,
    definitionId,
    errorField: 'step.name',
  });
  return {
    value: resolved.value,
    diagnostics: resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: 'step.name'})),
  };
}

function winningEnv(params: {
  readonly workflowEnv: WorkflowModel['env'];
  readonly workflowEnvTemplates: ResolveStepConfigParams['workflowEnvTemplates'];
  readonly jobEnv: WorkflowModelJob['env'];
  readonly jobEnvTemplates: ResolveStepConfigParams['jobEnvTemplates'];
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
    readonly templates: Readonly<Record<string, WorkflowFieldTemplate>> | undefined;
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

function freezeField(params: {
  readonly field: WorkflowInterpolationField;
  readonly template: WorkflowFieldTemplate;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly definitionId: string;
  readonly errorField: InterpolationUnresolvableField;
  readonly envKey?: string;
}): ReturnType<typeof freezeResolvedFieldAtSite> {
  try {
    return freezeResolvedFieldAtSite({
      field: {segments: params.template},
      context: params.context,
      site: params.site,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    });
  } catch (error) {
    const isTemplateError = error instanceof WorkflowTemplateResolutionError;
    if (isTemplateError) {
      throw interpolationError(params.definitionId, params.errorField, error, params.envKey);
    }
    throw error;
  }
}

function resolveField(params: {
  readonly field: WorkflowInterpolationField;
  readonly template: WorkflowFieldTemplate;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly definitionId: string;
  readonly errorField: InterpolationUnresolvableField;
  readonly envKey?: string;
}): ReturnType<typeof resolveFieldAtSite> {
  try {
    return resolveFieldAtSite({
      field: {segments: params.template},
      context: params.context,
      site: params.site,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    });
  } catch (error) {
    const isTemplateError = error instanceof WorkflowTemplateResolutionError;
    if (isTemplateError) {
      throw interpolationError(params.definitionId, params.errorField, error, params.envKey);
    }
    throw error;
  }
}

function literalField(value: string): {readonly segments: WorkflowFieldTemplate} {
  return {segments: [{kind: 'literal', value}]};
}

function interpolationError(
  definitionId: string,
  field: InterpolationUnresolvableField,
  error: WorkflowTemplateResolutionError | UnsafeRunInterpolationError,
  envKey?: string,
): InterpolationUnresolvableError {
  return new InterpolationUnresolvableError(definitionId, {
    field,
    source: error.source,
    ...(envKey === undefined ? {} : {envKey}),
    cause: error,
  });
}

function stepGateConfig(gate: NonNullable<WorkflowModelStep['gate']>): Record<string, unknown> {
  const hasSuccessIf = gate.successIf !== undefined;
  const hasOnFailure = gate.onFailure !== undefined;
  const hasOnFailureOutput = gate.onFailure?.output !== undefined;

  return {
    ...(hasSuccessIf
      ? {
          success_if: {
            language: gate.successIf.language,
            check: gate.successIf.check,
            source: gate.successIf.source,
          },
        }
      : {}),
    ...(hasOnFailure
      ? {
          on_failure: {
            restart_from: gate.onFailure.restartFrom,
            ...(hasOnFailureOutput ? {output: gate.onFailure.output} : {}),
          },
        }
      : {}),
  };
}
