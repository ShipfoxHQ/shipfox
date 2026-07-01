import {
  InvalidAgentModelError,
  UnsupportedAgentProviderError,
} from '@shipfox/api-agent/core/errors';
import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {MaterializedAgentStepConfigDto} from '@shipfox/api-agent-dto';
import type {WorkflowEnvTemplates, WorkflowModel} from '@shipfox/api-definitions';
import {
  getWorkflowContextDefinition,
  resolveRunCommand,
  resolveWorkflowTemplate,
  rootsAvailableAt,
  UnsafeRunInterpolationError,
  type WorkflowContextName,
  type WorkflowContextPhase,
  type WorkflowExpressionEvaluationContext,
  type WorkflowTemplateDiagnostic,
  WorkflowTemplateResolutionError,
  workflowContextNames,
} from '@shipfox/expression';
import {AgentConfigUnresolvableError, InterpolationUnresolvableError} from '#core/errors.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelRunStep = Extract<WorkflowModelStep, {kind: 'run'}>;
type WorkflowModelAgentStep = Extract<WorkflowModelStep, {kind: 'agent'}>;
type WorkflowFieldTemplate = NonNullable<NonNullable<WorkflowModelRunStep['templates']>['command']>;

export type StepConfigField =
  | 'run'
  | 'env'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'step.name';

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
  readonly phase: WorkflowContextPhase;
  readonly resolveAgentDefaults: AgentDefaultsResolver;
  readonly definitionId: string;
}

interface WinningEnvValue {
  readonly value: string;
  readonly template?: WorkflowFieldTemplate;
}

export function resolveStepConfig(params: ResolveStepConfigParams): ResolvedStepConfig {
  try {
    const effective = buildStepConfig({...params, mode: 'effective'});
    const authoredConfig = effective.hasTemplates
      ? buildStepConfig({...params, mode: 'authored'}).config
      : null;
    const name = resolveStepName(params.step, params.context, params.phase);

    return {
      config: effective.config,
      authoredConfig,
      ...(name.value === undefined ? {} : {name: name.value}),
      diagnostics: [...effective.diagnostics, ...name.diagnostics],
    };
  } catch (error) {
    if (
      error instanceof UnsafeRunInterpolationError ||
      error instanceof WorkflowTemplateResolutionError
    ) {
      throw new InterpolationUnresolvableError(params.definitionId, {cause: error});
    }
    throw error;
  }
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
    const envResolution = resolveEnv(env, params.context, params.phase, params.mode);
    const commandResolution = resolveCommand({
      step: params.step,
      envKeys: Object.keys(envResolution.env),
      context: params.context,
      phase: params.phase,
      mode: params.mode,
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
  readonly phase: WorkflowContextPhase;
  readonly mode: 'effective' | 'authored';
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

  const resolved = resolveRunCommand(template, params.context, {
    reservedNames: params.envKeys,
    requiredContextRoots: requiredTrustedRoots(template, params.phase),
  });

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
  phase: WorkflowContextPhase,
  mode: 'effective' | 'authored',
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
    const resolved = resolveWorkflowTemplate(entry.template, context, {
      requiredContextRoots: requiredTrustedRoots(entry.template, phase),
    });
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
    phase: params.phase,
    diagnostics,
  });
  const model = resolveOptionalAgentField({
    field: 'agent.model',
    value: step.model,
    template: step.templates?.model,
    context,
    mode: params.mode,
    phase: params.phase,
    diagnostics,
  });
  const provider = resolveOptionalAgentField({
    field: 'agent.provider',
    value: step.provider,
    template: step.templates?.provider,
    context,
    mode: params.mode,
    phase: params.phase,
    diagnostics,
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
    return {config: {...resolved, prompt}, diagnostics, hasTemplates};
  } catch (error) {
    if (error instanceof UnsupportedAgentProviderError || error instanceof InvalidAgentModelError) {
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
  readonly phase: WorkflowContextPhase;
  readonly mode: 'effective' | 'authored';
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
}): string {
  if (params.template === undefined || params.mode === 'authored') return params.value;

  const resolved = resolveWorkflowTemplate(params.template, params.context, {
    requiredContextRoots: requiredTrustedRoots(params.template, params.phase),
  });
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
  readonly phase: WorkflowContextPhase;
  readonly mode: 'effective' | 'authored';
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
}): string | undefined {
  if (params.value === undefined) return undefined;
  return resolveAgentField({...params, value: params.value});
}

function resolveStepName(
  step: WorkflowModelStep,
  context: WorkflowExpressionEvaluationContext,
  phase: WorkflowContextPhase,
): {
  readonly value: string | undefined;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
} {
  if (step.name === undefined) return {value: undefined, diagnostics: []};
  if (step.templates?.name === undefined) return {value: step.name, diagnostics: []};

  const resolved = resolveWorkflowTemplate(step.templates.name, context, {
    requiredContextRoots: requiredStepNameRoots(step.templates.name, phase),
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
      merged[key] = template === undefined ? {value} : {value, template};
    }
  }

  return merged;
}

function requiredTrustedRoots(
  segments: readonly unknown[],
  phase: WorkflowContextPhase,
): WorkflowContextName[] {
  const roots = new Set<WorkflowContextName>();
  const availableRoots = new Set(rootsAvailableAt(phase));

  for (const segment of segments) {
    if (!hasContextRoots(segment)) continue;
    for (const root of segment.contextRoots) {
      if (!isWorkflowContextName(root)) continue;
      if (!availableRoots.has(root)) continue;
      if (getWorkflowContextDefinition(root).trustTier === 'trusted') roots.add(root);
    }
  }

  return [...roots];
}

function requiredStepNameRoots(
  segments: readonly unknown[],
  phase: WorkflowContextPhase,
): WorkflowContextName[] {
  const roots = new Set<WorkflowContextName>(requiredTrustedRoots(segments, phase));
  const availableRoots = new Set(rootsAvailableAt(phase));

  for (const segment of segments) {
    if (!hasContextRoots(segment)) continue;
    for (const root of segment.contextRoots) {
      if (!isWorkflowContextName(root)) continue;
      if (!availableRoots.has(root)) roots.add(root);
    }
  }

  return [...roots];
}

function hasContextRoots(value: unknown): value is {readonly contextRoots: readonly string[]} {
  return typeof value === 'object' && value !== null && 'contextRoots' in value;
}

function isWorkflowContextName(value: string): value is WorkflowContextName {
  return workflowContextNameSet.has(value);
}

const workflowContextNameSet: ReadonlySet<string> = new Set(workflowContextNames);

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
