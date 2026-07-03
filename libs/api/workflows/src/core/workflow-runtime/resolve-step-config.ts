import {
  InvalidAgentModelError,
  UnsupportedModelProviderError,
} from '@shipfox/api-agent/core/errors';
import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {MaterializedAgentStepConfigDto} from '@shipfox/api-agent-dto';
import type {WorkflowEnvTemplates, WorkflowModel} from '@shipfox/api-definitions';
import {
  type AvailabilitySite,
  getWorkflowInterpolationFieldFailurePolicy,
  resolveRunCommand,
  resolveWorkflowTemplate,
  rootsAvailableAt,
  UnsafeRunInterpolationError,
  type WorkflowExpressionEvaluationContext,
  type WorkflowInterpolationField,
  type WorkflowTemplateDiagnostic,
  WorkflowTemplateResolutionError,
  type WorkflowTemplateResolutionOptions,
} from '@shipfox/expression';
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

export type StepConfigField = InterpolationUnresolvableField;

export interface WorkflowStepTemplateDiagnostic extends WorkflowTemplateDiagnostic {
  readonly field: StepConfigField;
  readonly envKey?: string;
}

export interface ResolvedStepConfig {
  readonly config: Record<string, unknown>;
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

export function resolveStepConfig(params: ResolveStepConfigParams): ResolvedStepConfig {
  const effective = buildStepConfig({...params, mode: 'effective'});
  const authoredConfig = effective.hasTemplates
    ? buildStepConfig({...params, mode: 'authored'}).config
    : null;
  const name = resolveStepName(params.step, params.context, params.site, params.definitionId);

  return {
    config: effective.config,
    authoredConfig,
    ...(name.value === undefined || name.value === '' ? {} : {name: name.value}),
    diagnostics: [...effective.diagnostics, ...name.diagnostics],
  };
}

function buildStepConfig(
  params: ResolveStepConfigParams & {readonly mode: 'effective' | 'authored'},
): {
  readonly config: Record<string, unknown>;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
} {
  const gate = params.step.gate === undefined ? {} : {gate: stepGateConfig(params.step.gate)};

  if (params.step.kind === 'run') {
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
    const envConfig = Object.keys(mergedEnv).length === 0 ? {} : {env: mergedEnv};

    return {
      config: {run: commandResolution.command, ...envConfig, ...gate},
      diagnostics: [...envResolution.diagnostics, ...commandResolution.diagnostics],
      hasTemplates: envResolution.hasTemplates || commandResolution.hasTemplate,
    };
  }

  const agent = agentStepConfig(params.step, params.context, params);
  return {
    config: {...agent.config, ...gate},
    diagnostics: agent.diagnostics,
    hasTemplates: agent.hasTemplates,
  };
}

function resolveCommand(params: {
  readonly step: WorkflowModelRunStep;
  readonly envKeys: readonly string[];
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly mode: 'effective' | 'authored';
  readonly definitionId: string;
}): {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplate: boolean;
} {
  const template = params.step.templates?.command;
  if (template === undefined) {
    return {command: params.step.command.value, env: {}, diagnostics: [], hasTemplate: false};
  }

  if (params.mode === 'authored') {
    return {command: params.step.command.value, env: {}, diagnostics: [], hasTemplate: true};
  }

  let resolved: ReturnType<typeof resolveRunCommand>;
  try {
    resolved = resolveRunCommand(template, params.context, {
      reservedNames: params.envKeys,
      ...resolutionOptions('run', params.site),
    });
  } catch (error) {
    if (
      error instanceof UnsafeRunInterpolationError ||
      error instanceof WorkflowTemplateResolutionError
    ) {
      throw interpolationError(params.definitionId, 'run', error);
    }
    throw error;
  }

  return {
    command: resolved.command,
    env: resolved.env,
    diagnostics: resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: 'run'})),
    hasTemplate: true,
  };
}

function resolveEnv(
  env: Readonly<Record<string, WinningEnvValue>>,
  context: WorkflowExpressionEvaluationContext,
  site: AvailabilitySite,
  mode: 'effective' | 'authored',
  definitionId: string,
): {
  readonly env: Readonly<Record<string, string>>;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
} {
  const resolvedEnv: Record<string, string> = {};
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  let hasTemplates = false;

  for (const [key, entry] of Object.entries(env)) {
    if (entry.template === undefined || mode === 'authored') {
      resolvedEnv[key] = entry.value;
      hasTemplates ||= entry.template !== undefined;
      continue;
    }

    hasTemplates = true;
    let resolved: ReturnType<typeof resolveWorkflowTemplate>;
    try {
      resolved = resolveWorkflowTemplate(
        entry.template,
        context,
        resolutionOptions('env.value', site),
      );
    } catch (error) {
      if (error instanceof WorkflowTemplateResolutionError) {
        throw interpolationError(definitionId, 'env', error, key);
      }
      throw error;
    }
    resolvedEnv[key] = resolved.value;
    diagnostics.push(
      ...resolved.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        field: 'env' as const,
        envKey: key,
      })),
    );
  }

  return {env: resolvedEnv, diagnostics, hasTemplates};
}

function agentStepConfig(
  step: WorkflowModelAgentStep,
  context: WorkflowExpressionEvaluationContext,
  params: ResolveStepConfigParams & {readonly mode: 'effective' | 'authored'},
): {
  readonly config: MaterializedAgentStepConfigDto | Pick<MaterializedAgentStepConfigDto, 'prompt'>;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
} {
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

  if (params.mode === 'authored') {
    return {
      config: {
        ...(provider === undefined ? {} : {provider}),
        ...(model === undefined ? {} : {model}),
        ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
        prompt,
      },
      diagnostics,
      hasTemplates,
    };
  }

  try {
    const resolved = params.resolveAgentDefaults({
      provider,
      model,
      thinking: step.thinking,
    });
    return {
      config: {
        provider: resolved.provider,
        model: resolved.model,
        thinking: resolved.thinking,
        prompt,
      },
      diagnostics,
      hasTemplates,
    };
  } catch (error) {
    if (error instanceof UnsupportedModelProviderError || error instanceof InvalidAgentModelError) {
      throw new AgentConfigUnresolvableError(params.definitionId, {cause: error});
    }
    throw error;
  }
}

function resolveAgentField(params: {
  readonly field: Extract<StepConfigField, `agent.${string}`>;
  readonly value: string;
  readonly template: WorkflowFieldTemplate | undefined;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly mode: 'effective' | 'authored';
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly definitionId: string;
}): string {
  if (params.template === undefined || params.mode === 'authored') return params.value;

  let resolved: ReturnType<typeof resolveWorkflowTemplate>;
  try {
    resolved = resolveWorkflowTemplate(
      params.template,
      params.context,
      resolutionOptions(params.field, params.site),
    );
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw interpolationError(params.definitionId, params.field, error);
    }
    throw error;
  }
  params.diagnostics.push(
    ...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: params.field})),
  );
  return resolved.value;
}

function resolveOptionalAgentField(params: {
  readonly field: Extract<StepConfigField, `agent.${string}`>;
  readonly value: string | undefined;
  readonly template: WorkflowFieldTemplate | undefined;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly mode: 'effective' | 'authored';
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly definitionId: string;
}): string | undefined {
  if (params.value === undefined) return undefined;
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
  if (step.name === undefined) return {value: undefined, diagnostics: []};
  if (step.templates?.name === undefined) return {value: step.name, diagnostics: []};

  let resolved: ReturnType<typeof resolveWorkflowTemplate>;
  try {
    resolved = resolveWorkflowTemplate(
      step.templates.name,
      context,
      resolutionOptions('step.name', site),
    );
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw interpolationError(definitionId, 'step.name', error);
    }
    throw error;
  }
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
      merged[key] = template === undefined ? {value} : {value, template};
    }
  }

  return merged;
}

function resolutionOptions(
  field: WorkflowInterpolationField,
  site: AvailabilitySite,
): WorkflowTemplateResolutionOptions {
  return {
    failurePolicy: getWorkflowInterpolationFieldFailurePolicy(field),
    availableRoots: rootsAvailableAt(site),
  };
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
  return {
    ...(gate.successIf === undefined
      ? {}
      : {
          success_if: {
            language: gate.successIf.language,
            check: gate.successIf.check,
            source: gate.successIf.source,
          },
        }),
    ...(gate.onFailure === undefined
      ? {}
      : {
          on_failure: {
            restart_from: gate.onFailure.restartFrom,
            ...(gate.onFailure.output === undefined ? {} : {output: gate.onFailure.output}),
          },
        }),
  };
}
