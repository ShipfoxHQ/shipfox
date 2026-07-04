import type {WorkflowModel} from '@shipfox/api-definitions';
import {
  type MaterializedSecretBindingDto,
  materializedSecretBindingSchema,
  type SecretBindingSegmentDto,
  secretStoreSchema,
} from '@shipfox/api-secrets-dto';
import {
  analyzeContextKeyAccess,
  type EvaluationTraceEntry,
  evaluationTraceEntry,
  hoistPlannedRunCommand,
  type ResolvedField,
  type ResolvedFieldSegment,
  runnerFillTarget,
  UnsafeRunInterpolationError,
} from '@shipfox/expression';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {InterpolationUnresolvableError} from '#core/errors.js';
import {
  resolveStepField,
  type StepConfigField,
  stepConfigInterpolationError,
  type WorkflowStepEvaluationTraceEntry,
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
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

export function resolveRunStepConfig(params: ResolveRunStepConfigParams): RunStepConfig {
  const env = winningEnv(params);
  const envResolution = resolveEnv(env, params.context, params.mode, params.definitionId);
  const commandResolution = resolveCommand({
    step: params.step,
    envKeys: [...Object.keys(envResolution.env), ...Object.keys(envResolution.configPlan)],
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
    trace: [...envResolution.trace, ...commandResolution.trace],
    hasTemplates,
  };
}

export function completeRunDispatchConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: WorkflowStepEvaluationTraceEntry[];
}): void {
  const env = {...readConfigEnv(params.config)};
  const secretBindings: MaterializedSecretBindingDto[] = [];

  if (params.plan.run !== undefined) {
    const resolved = completeRunCommand({
      field: params.plan.run,
      context: params.context,
      definitionId: params.definitionId,
      reservedNames: Object.keys(env),
      trace: params.trace,
    });
    params.config.run = resolved.command;
    Object.assign(env, resolved.env);
    secretBindings.push(...resolved.secretBindings);
  }

  if (params.plan.env !== undefined) {
    for (const [key, field] of Object.entries(params.plan.env)) {
      const completed = completeDispatchField({
        field: 'env.value',
        traceField: 'env',
        errorField: 'env',
        template: field,
        context: params.context,
        definitionId: params.definitionId,
        envKey: key,
        trace: params.trace,
      });
      if (completed.kind === 'binding') secretBindings.push(completed.binding);
      else env[key] = completed.value;
    }
  }

  if (Object.keys(env).length > 0) params.config.env = env;
  if (secretBindings.length > 0) params.config.secret_bindings = secretBindings;
}

function completeRunCommand(params: {
  readonly field: ResolvedField;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly reservedNames: Iterable<string>;
  readonly trace: WorkflowStepEvaluationTraceEntry[];
}): {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly secretBindings: readonly MaterializedSecretBindingDto[];
} {
  const hoisted = hoistPlannedRunCommand({
    field: params.field,
    reservedNames: params.reservedNames,
  });
  const env: Record<string, string> = {};
  const secretBindings: MaterializedSecretBindingDto[] = [];

  for (const binding of hoisted.bindings) {
    const completed = completeDispatchField({
      field: 'run',
      traceField: 'run',
      errorField: 'run',
      template: {segments: [binding.segment]},
      context: params.context,
      definitionId: params.definitionId,
      envKey: binding.name,
      trace: params.trace,
    });
    if (completed.kind === 'binding') secretBindings.push(completed.binding);
    else env[binding.name] = completed.value;
  }

  return {command: hoisted.command, env, secretBindings};
}

type CompletedDispatchField =
  | {readonly kind: 'value'; readonly value: string}
  | {readonly kind: 'binding'; readonly binding: MaterializedSecretBindingDto};

function completeDispatchField(params: {
  readonly field: 'run' | 'env.value';
  readonly traceField: StepConfigField;
  readonly errorField: StepConfigField;
  readonly template: ResolvedField;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly envKey?: string;
  readonly trace: WorkflowStepEvaluationTraceEntry[];
}): CompletedDispatchField {
  const resolved = resolveStepField(params);
  params.trace.push(...tagTrace(resolved.trace, params.traceField, params.envKey));
  if (resolved.kind === 'frozen') return {kind: 'value', value: resolved.value};
  if (params.envKey !== undefined && containsOnlyRunnerSecretSegments(resolved.field)) {
    params.trace.push(
      ...runnerSecretReferenceTrace(resolved.field, params.traceField, params.envKey),
    );
    return {
      kind: 'binding',
      binding: secretBindingFromField(params.envKey, resolved.field),
    };
  }

  const source = resolved.field.segments.find((segment) => segment.kind === 'deferred')?.expression
    .source;
  throw new InterpolationUnresolvableError(params.definitionId, {
    field: params.errorField,
    source: source ?? params.field,
    ...(params.envKey === undefined ? {} : {envKey: params.envKey}),
  });
}

function containsOnlyRunnerSecretSegments(field: ResolvedField): boolean {
  return field.segments.every((segment) => {
    if (segment.kind === 'literal') return true;
    return (
      segment.fillTarget === runnerFillTarget &&
      segment.roots.length === 1 &&
      segment.roots[0] === 'secrets'
    );
  });
}

function secretBindingFromField(
  target: string,
  field: ResolvedField,
): MaterializedSecretBindingDto {
  const binding = {
    target,
    segments: field.segments.map(secretBindingSegment),
  };
  return materializedSecretBindingSchema.parse(binding);
}

function secretBindingSegment(segment: ResolvedFieldSegment): SecretBindingSegmentDto {
  if (segment.kind === 'literal') return {kind: 'literal', value: segment.value};

  const keyAccess = analyzeContextKeyAccess(segment.expression);
  const reference = keyAccess.references.find((candidate) => candidate.root === 'secrets');
  if (reference === undefined) {
    throw new Error(
      `Runner secret segment did not contain a secret reference: ${segment.expression.source}`,
    );
  }

  return {
    kind: 'secret',
    store: secretStoreSchema.parse(reference.store ?? 'local'),
    key: reference.key,
  };
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
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
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
      trace: [],
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
      trace: [],
      hasTemplate: true,
    };
  }

  const env: Record<string, string> = {};
  const configPlan: Record<string, ResolvedField> = {};
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const trace: WorkflowStepEvaluationTraceEntry[] = [];
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
    trace.push(...tagTrace(resolved.trace, 'run'));
  }

  return {
    command: hoisted.command,
    env,
    configPlan,
    diagnostics,
    trace,
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
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
} {
  const resolvedEnv: Record<string, string> = {};
  const configPlan: Record<string, ResolvedField> = {};
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const trace: WorkflowStepEvaluationTraceEntry[] = [];
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
    trace.push(...tagTrace(resolved.trace, 'env', key));
  }

  return {env: resolvedEnv, configPlan, diagnostics, trace, hasTemplates};
}

function tagTrace(
  trace: readonly EvaluationTraceEntry[],
  field: StepConfigField,
  envKey?: string,
): WorkflowStepEvaluationTraceEntry[] {
  return trace.map((entry) => ({
    ...entry,
    field,
    ...(envKey === undefined ? {} : {envKey}),
  }));
}

function runnerSecretReferenceTrace(
  field: ResolvedField,
  stepField: StepConfigField,
  envKey: string,
): WorkflowStepEvaluationTraceEntry[] {
  return field.segments.flatMap((segment) => {
    if (segment.kind === 'literal') return [];
    return [
      {
        ...evaluationTraceEntry({
          expression: segment.expression.source,
          roots: segment.roots,
          fillTarget: runnerFillTarget,
          evaluatedAt: 'step-dispatch',
          reference: true,
        }),
        field: stepField,
        envKey,
      },
    ];
  });
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
