import type {WorkflowFieldTemplate, WorkflowModel} from '@shipfox/api-definitions-dto';
import {
  type MaterializedSecretBindingDto,
  materializedSecretBindingSchema,
} from '@shipfox/api-secrets-dto';
import type {ResolvedField} from '@shipfox/expression';
import type {PersistedEvaluationTraceEntry, StepConfigDispatchPlan} from '#core/entities/step.js';
import {
  completeStepFieldWithTrace,
  literalField,
  resolveStepField,
  type WorkflowStepEvaluationTraceEntry,
  type WorkflowStepTemplateDiagnostic,
} from './fields.js';
import {completeDispatchField} from './run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJobContainer = NonNullable<WorkflowModel['jobs'][number]['container']>;
type ContainerPlan = NonNullable<StepConfigDispatchPlan['container']>;
type ContainerField =
  | 'job.container.image'
  | 'job.container.options'
  | 'job.container.credentials'
  | 'job.container.env.value';

/** The job container as the runner reads it from the `config` of the setup step. */
export interface SetupContainerConfig {
  readonly image: string;
  readonly options: string;
  readonly docker_socket: boolean;
  readonly env: Readonly<Record<string, string>>;
  /** Present when the username is a literal. A secret username is a binding. */
  readonly username?: string;
}

export interface ResolvedSetupContainer {
  readonly config: SetupContainerConfig;
  readonly configPlan: ContainerPlan | undefined;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
}

type FieldResolution = {readonly value: string} | {readonly deferred: ResolvedField};

type ResolveContainerField = (
  field: ContainerField,
  authored: string,
  template: WorkflowFieldTemplate | undefined,
  envKey?: string,
) => FieldResolution;

/**
 * Fills what this site can fill. The image and options are server fields, and a job that
 * reads an earlier job's outputs can only fill them at dispatch. The credentials and env
 * values may hold runner-filled secrets, which stay references until dispatch.
 */
export function resolveSetupContainer(params: {
  readonly container: WorkflowModelJobContainer;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
}): ResolvedSetupContainer {
  const {container, context, definitionId} = params;
  const templates = container.templates;
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const trace: WorkflowStepEvaluationTraceEntry[] = [];

  const resolve: ResolveContainerField = (field, authored, template, envKey) => {
    if (template === undefined) return {value: authored};
    const key = envKey === undefined ? {} : {envKey};
    const resolved = resolveStepField({
      field,
      template: {segments: template},
      context,
      definitionId,
      errorField: field,
      ...key,
    });
    diagnostics.push(...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field, ...key})));
    trace.push(...resolved.trace.map((entry) => ({...entry, field, ...key})));
    return resolved.kind === 'frozen' ? {value: resolved.value} : {deferred: resolved.field};
  };

  const image = resolve('job.container.image', container.image, templates?.image);
  const options = resolve('job.container.options', container.options ?? '', templates?.options);
  const credentials = resolveCredentials(container, resolve);
  const env = resolveEnv(container, resolve);
  const plan: ContainerPlan = {
    ...('deferred' in image ? {image: image.deferred} : {}),
    ...('deferred' in options ? {options: options.deferred} : {}),
    ...credentials.plan,
    ...(Object.keys(env.plan).length === 0 ? {} : {env: env.plan}),
  };

  return {
    config: {
      image: 'value' in image ? image.value : '',
      options: 'value' in options ? options.value : '',
      docker_socket: container.dockerSocket,
      env: env.values,
      ...(credentials.username === undefined ? {} : {username: credentials.username}),
    },
    configPlan: Object.keys(plan).length === 0 ? undefined : plan,
    diagnostics,
    trace,
  };
}

function resolveCredentials(
  container: WorkflowModelJobContainer,
  resolve: ResolveContainerField,
): {readonly username?: string; readonly plan: Pick<ContainerPlan, 'username' | 'password'>} {
  const {credentials, templates} = container;
  if (credentials === undefined) return {plan: {}};

  const username = resolve('job.container.credentials', credentials.username, templates?.username);
  // The password is always handed over as a binding, so a literal one rides in the plan.
  const password = resolve('job.container.credentials', credentials.password, templates?.password);
  return {
    ...('value' in username ? {username: username.value} : {}),
    plan: {
      ...('deferred' in username ? {username: username.deferred} : {}),
      password: 'deferred' in password ? password.deferred : literalField(password.value),
    },
  };
}

function resolveEnv(
  container: WorkflowModelJobContainer,
  resolve: ResolveContainerField,
): {readonly values: Record<string, string>; readonly plan: Record<string, ResolvedField>} {
  const values: Record<string, string> = {};
  const plan: Record<string, ResolvedField> = {};
  for (const [key, authored] of Object.entries(container.env ?? {})) {
    const resolved = resolve(
      'job.container.env.value',
      authored,
      container.templates?.env?.[key],
      key,
    );
    if ('deferred' in resolved) plan[key] = resolved.deferred;
    else values[key] = resolved.value;
  }
  return {values, plan};
}

interface ContainerCompletion {
  readonly container: Record<string, unknown>;
  readonly env: Record<string, string>;
  readonly bindings: MaterializedSecretBindingDto[];
}

/**
 * Completes the container of a setup step at dispatch. The registry password and the
 * secret values become bindings the runner fills; everything else lands in `container`.
 */
export function completeSetupContainerConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const plan = params.plan.container;
  if (plan === undefined) return;

  const current = params.config.container;
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error('Container dispatch config is missing an object');
  }
  const completion: ContainerCompletion = {
    container: {...current} as Record<string, unknown>,
    env: readEnv((current as Record<string, unknown>).env),
    bindings: [],
  };

  completeServerField({...params, completion, field: 'image', template: plan.image});
  completeServerField({...params, completion, field: 'options', template: plan.options});
  completeCredentials({...params, completion, plan});
  for (const [name, template] of Object.entries(plan.env ?? {})) {
    const completed = completeSecretField({
      ...params,
      template,
      field: 'job.container.env.value',
      target: {kind: 'container_env', name},
    });
    if (completed.kind === 'binding') completion.bindings.push(completed.binding);
    else completion.env[name] = completed.value;
  }

  params.config.container = {...completion.container, env: completion.env};
  if (completion.bindings.length > 0) params.config.secret_bindings = completion.bindings;
}

function completeServerField(params: {
  readonly completion: ContainerCompletion;
  readonly field: 'image' | 'options';
  readonly template: ResolvedField | undefined;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  if (params.template === undefined) return;

  const field = params.field === 'image' ? 'job.container.image' : 'job.container.options';
  const resolved = completeStepFieldWithTrace({
    field,
    template: params.template,
    context: params.context,
    definitionId: params.definitionId,
    errorField: field,
  });
  params.completion.container[params.field] = resolved.value;
  params.trace.push(...resolved.trace.map((entry) => ({...entry, field})));
}

function completeCredentials(params: {
  readonly completion: ContainerCompletion;
  readonly plan: ContainerPlan;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const {completion, plan} = params;
  if (plan.username !== undefined) {
    const completed = completeSecretField({
      ...params,
      template: plan.username,
      field: 'job.container.credentials',
      target: {kind: 'container_credential', field: 'username'},
    });
    if (completed.kind === 'binding') completion.bindings.push(completed.binding);
    else completion.container.username = completed.value;
  }

  if (plan.password !== undefined) {
    const target = {kind: 'container_credential', field: 'password'} as const;
    const completed = completeSecretField({
      ...params,
      template: plan.password,
      field: 'job.container.credentials',
      target,
    });
    completion.bindings.push(
      completed.kind === 'binding'
        ? completed.binding
        : materializedSecretBindingSchema.parse({
            target,
            segments: [{kind: 'literal', value: completed.value}],
          }),
    );
  }
}

function completeSecretField(params: {
  readonly template: ResolvedField;
  readonly field: 'job.container.credentials' | 'job.container.env.value';
  readonly target: MaterializedSecretBindingDto['target'];
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): ReturnType<typeof completeDispatchField> {
  return completeDispatchField({
    field: params.field,
    traceField: params.field,
    errorField: params.field,
    template: params.template,
    context: params.context,
    definitionId: params.definitionId,
    target: params.target,
    trace: params.trace,
  });
}

function readEnv(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'string' ? [[key, entry]] : [],
    ),
  );
}
