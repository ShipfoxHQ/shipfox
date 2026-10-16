import {
  DEFAULT_JOB_CHECKOUT,
  flattenJobSteps,
  type WorkflowModel,
} from '@shipfox/api-definitions-dto';
import type {WorkflowExpression} from '@shipfox/expression';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from '#core/agent-tools.js';
import type {StepConfigDispatchPlan, StepRunAfter} from '#core/entities/step.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  InterpolationUnresolvableError,
} from '#core/errors.js';
import {resolveSetupContainer} from './container.js';
import {resolveStepConfig, type WorkflowStepTemplateDiagnostic} from './resolve-step-config.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelCompositeStep = Extract<WorkflowModelStep, {kind: 'composite'}>;
type WorkflowSourceLocation = NonNullable<WorkflowModelStep['sourceLocation']>;

const FIRST_LINE_PATTERN = /\r?\n/;

export interface MaterializedWorkflowStep {
  readonly key: string | null;
  readonly name: string;
  readonly sourceLocation: WorkflowSourceLocation | null;
  readonly status: 'pending';
  readonly type: WorkflowModelStep['kind'] | 'setup' | 'post';
  /** The position of the composite step that holds this step. Null for a job step. */
  readonly parentPosition: number | null;
  readonly config: Readonly<Record<string, unknown>>;
  readonly condition?: WorkflowExpression;
  readonly runAfter: StepRunAfter;
  readonly configPlan?: StepConfigDispatchPlan;
  readonly authoredConfig: Readonly<Record<string, unknown>> | null;
  readonly diagnostics?: readonly WorkflowStepTemplateDiagnostic[];
  readonly position: number;
}

export interface MaterializeJobExecutionStepsParams {
  readonly model: WorkflowModel;
  readonly job: WorkflowModelJob;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly resolveAgentDefaultsForStep?:
    | ((stepPosition: number) => AgentDefaultsResolver | undefined)
    | undefined;
  readonly definitionId?: string | undefined;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

// Synthetic "Set up job" step prepended when a job execution's steps are materialized.
// The runner prepares the workspace here; failures report through the normal step
// protocol instead of hanging the job until the lease/timeout fires. Its config carries
// checkout policy and the job container. Registry credentials and secret container env
// values are bindings, never values.
const SETUP_STEP: Omit<MaterializedWorkflowStep, 'config'> = {
  key: null,
  name: 'Set up job',
  sourceLocation: null,
  status: 'pending',
  type: 'setup',
  parentPosition: null,
  runAfter: 'success',
  authoredConfig: null,
  position: 0,
};

export async function materializeJobExecutionSteps(
  params: MaterializeJobExecutionStepsParams,
): Promise<readonly MaterializedWorkflowStep[]> {
  const {
    model,
    job,
    context,
    resolveAgentDefaults,
    resolveAgentDefaultsForStep,
    definitionId = model.name,
    agentToolContext,
    agentToolSnapshot,
  } = params;

  const authored = await Promise.all(
    scopedJobSteps(job).map(async ({step, position, parentPosition, composites}) => {
      const stepContext = {
        ...context.values,
        job: {key: job.key, name: job.name ?? job.key},
      };
      // A composite's env is the base of its inner steps. It is filled when the composite opens,
      // so the workflow and job values of those keys must not shadow it.
      const inheritedEnvKeys = compositeEnvKeys(composites);
      const resolved = await resolveStepConfig({
        jobKey: job.key,
        step,
        workflowEnv: withoutKeys(model.env, inheritedEnvKeys),
        workflowEnvTemplates: withoutKeys(model.templates?.env, inheritedEnvKeys),
        jobEnv: withoutKeys(job.env, inheritedEnvKeys),
        jobEnvTemplates: withoutKeys(job.templates?.env, inheritedEnvKeys),
        context: stepContext,
        site: context.site,
        resolveAgentDefaults: resolveAgentDefaultsForStep?.(position - 1) ?? resolveAgentDefaults,
        definitionId,
        agentToolContext,
        agentToolSnapshot,
      }).catch((error: unknown) => {
        if (
          !(
            error instanceof AgentConfigUnresolvableError ||
            error instanceof AgentIntegrationMaterializationError ||
            error instanceof InterpolationUnresolvableError
          )
        ) {
          throw error;
        }
        throw error.at({
          jobKey: job.key,
          step: {
            key: step.key,
            name: step.name,
            index: position,
            line: step.sourceLocation?.startLine,
          },
        });
      });
      return {
        key: step.key ?? null,
        name: resolved.name ?? stepDisplayName(step, resolved.config),
        sourceLocation: step.sourceLocation ?? null,
        status: 'pending' as const,
        type: step.kind,
        parentPosition,
        config: scopedStepConfig({
          config: materializedStepConfig({config: resolved.config, step, position}),
          step,
          composites,
        }),
        ...(step.if === undefined ? {} : {condition: step.if}),
        // Models stored before `run_after` keep their old gate: an `if` replaced it.
        runAfter: step.runAfter ?? (step.if === undefined ? 'success' : 'always'),
        authoredConfig: resolved.authoredConfig,
        ...materializedConfigPlan(resolved.configPlan, resolved.trace),
        ...(resolved.diagnostics.length === 0 ? {} : {diagnostics: resolved.diagnostics}),
        position,
      };
    }),
  );

  return [
    setupStepForJob({job, context, definitionId}),
    ...authored,
    ...postStepsForJob({job, authored}),
  ];
}

interface ScopedModelStep {
  readonly step: WorkflowModelStep;
  /** The row position: the index in `flattenJobSteps` plus one, after the setup step. */
  readonly position: number;
  readonly parentPosition: number | null;
  /** The composite steps that hold the step, outermost first. */
  readonly composites: readonly WorkflowModelCompositeStep[];
}

// Pre-order, like `flattenJobSteps`: a composite, then its inner steps, nested composites inline.
function scopedJobSteps(job: WorkflowModelJob): ScopedModelStep[] {
  const scoped: ScopedModelStep[] = [];
  const visit = (
    steps: readonly WorkflowModelStep[],
    parentPosition: number | null,
    composites: readonly WorkflowModelCompositeStep[],
  ): void => {
    for (const step of steps) {
      const position = scoped.length + 1;
      scoped.push({step, position, parentPosition, composites});
      if (step.kind === 'composite') visit(step.steps, position, [...composites, step]);
    }
  };
  visit(job.steps, null, []);
  return scoped;
}

function compositeEnvKeys(composites: readonly WorkflowModelCompositeStep[]): ReadonlySet<string> {
  return new Set(composites.flatMap((composite) => Object.keys(composite.env ?? {})));
}

function withoutKeys<Value>(
  record: Readonly<Record<string, Value>> | undefined,
  keys: ReadonlySet<string>,
): Readonly<Record<string, Value>> | undefined {
  if (record === undefined || keys.size === 0) return record;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));
}

// A runner step inside a composite gets the files of every composite that holds it: it can read
// its own `action.path`, and an outer path through the env, working directory, or inputs it
// inherits. A runner extracts each bundle once per job. An inner agent session is scoped to the
// composite use when it is claimed.
function scopedStepConfig(params: {
  readonly config: Readonly<Record<string, unknown>>;
  readonly step: WorkflowModelStep;
  readonly composites: readonly WorkflowModelCompositeStep[];
}): Readonly<Record<string, unknown>> {
  if (params.composites.length === 0) return params.config;
  const runsOnRunner = params.step.kind !== 'composite' && params.step.kind !== 'tool';
  const sessionScope = params.step.kind === 'agent' ? params.step.session?.scope : undefined;
  return {
    ...params.config,
    ...(runsOnRunner
      ? {
          action_bundles: [
            ...new Set(params.composites.map((composite) => composite.composite.digest)),
          ],
        }
      : {}),
    ...(sessionScope === undefined ? {} : {session_scope: sessionScope}),
  };
}

// One post row per action step that declares `post`, last action in run order first. The rows
// exist from the start so positions stay dense; a post whose main entry never reached the runner
// is skipped at dispatch.
function postStepsForJob(params: {
  readonly job: WorkflowModelJob;
  readonly authored: readonly MaterializedWorkflowStep[];
}): MaterializedWorkflowStep[] {
  const posts: MaterializedWorkflowStep[] = [];
  const steps = flattenJobSteps(params.job);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    const main = params.authored[index];
    if (step?.kind !== 'action' || main === undefined || step.action.post === undefined) continue;
    const parent =
      main.parentPosition === null ? undefined : params.authored[main.parentPosition - 1];
    posts.push(
      postStepForAction({
        step,
        main,
        parentName: parent?.name,
        position: params.authored.length + 1 + posts.length,
      }),
    );
  }
  return posts;
}

function postStepForAction(params: {
  readonly step: Extract<WorkflowModelStep, {kind: 'action'}>;
  readonly main: MaterializedWorkflowStep;
  readonly parentName: string | undefined;
  readonly position: number;
}): MaterializedWorkflowStep {
  const {step, main, position} = params;
  const {action, job_key: jobKey, integrations} = main.config;
  if (step.action.post === undefined || action === null || typeof action !== 'object') {
    throw new Error('Action step config is missing its action');
  }
  return {
    key: null,
    name:
      params.parentName === undefined
        ? `Post ${main.name}`
        : `Post ${params.parentName} › ${main.name}`,
    sourceLocation: main.sourceLocation,
    status: 'pending',
    type: 'post',
    parentPosition: null,
    config: {
      post: {main_position: main.position, failure: step.action.postFailure ?? 'warn'},
      // The runner starts the post entry where it would start `main`.
      action: {...action, main: step.action.post},
      job_key: jobKey,
      // The post reaches the same tools as its main entry.
      integrations,
      ...(main.config.action_bundles === undefined
        ? {}
        : {action_bundles: main.config.action_bundles}),
    },
    runAfter: 'always',
    authoredConfig: null,
    position,
  };
}

function setupStepForJob(params: {
  readonly job: WorkflowModelJob;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
}): MaterializedWorkflowStep {
  const {job, context, definitionId} = params;
  const checkout = setupCheckoutPolicy(job);
  const container =
    job.container === undefined
      ? null
      : resolveSetupContainer({container: job.container, context, definitionId});

  return {
    ...SETUP_STEP,
    config: {
      ...(checkout === null ? {} : {checkout}),
      ...(container === null ? {} : {container: container.config}),
    },
    ...(container === null
      ? {}
      : materializedConfigPlan(
          container.configPlan === undefined ? null : {container: container.configPlan},
          container.trace,
        )),
    ...(container === null || container.diagnostics.length === 0
      ? {}
      : {diagnostics: container.diagnostics}),
  };
}

function setupCheckoutPolicy(job: WorkflowModelJob) {
  if (job.checkout === false || firstStepOwnsJobRoot(job)) return null;

  const checkout = job.checkout ?? DEFAULT_JOB_CHECKOUT;
  return {
    permissions: checkout.permissions,
    persist_credentials: checkout.persistCredentials,
  };
}

// A leading checkout replaces the project checkout only when it lands at the job root.
// With its own `path` the project keeps the root, so later steps still find the repository.
function firstStepOwnsJobRoot(job: WorkflowModelJob): boolean {
  const first = job.steps[0];
  return first?.kind === 'checkout' && isRootPath(first.checkout.path);
}

function isRootPath(path: string | undefined): boolean {
  return path === undefined || path === '.' || path === './';
}

function materializedStepConfig(params: {
  readonly config: Readonly<Record<string, unknown>>;
  readonly step: WorkflowModelStep;
  readonly position: number;
}): Readonly<Record<string, unknown>> {
  if (
    params.step.kind !== 'checkout' ||
    params.position !== 1 ||
    params.step.checkout.path !== undefined
  ) {
    return params.config;
  }

  const checkout = params.config.checkout;
  if (checkout === null || typeof checkout !== 'object' || Array.isArray(checkout)) {
    throw new Error('Checkout materialization config is missing an object');
  }

  return {...params.config, checkout: {...checkout, path: '.'}};
}

function materializedConfigPlan(
  configPlan: StepConfigDispatchPlan | null,
  trace: NonNullable<StepConfigDispatchPlan['trace']>,
): {readonly configPlan?: StepConfigDispatchPlan} {
  if (configPlan === null && trace.length === 0) return {};
  return {configPlan: {...(configPlan ?? {}), ...(trace.length === 0 ? {} : {trace})}};
}

function stepDisplayName(
  step: WorkflowModelStep,
  config: Readonly<Record<string, unknown>>,
): string {
  const {kind} = step;
  switch (kind) {
    case 'run':
      return firstLine(step.command.value);
    case 'agent':
      return step.model === undefined
        ? firstLine(step.prompt)
        : `${step.model} · ${firstLine(step.prompt)}`;
    case 'checkout':
      return 'Checkout';
    case 'tool': {
      const tool = config.tool;
      const connectionSlug =
        tool !== null && typeof tool === 'object' && !Array.isArray(tool)
          ? (tool as Record<string, unknown>).connection_slug
          : undefined;
      const label =
        step.tool.method === undefined ? step.tool.id : `${step.tool.id}.${step.tool.method}`;
      return typeof connectionSlug === 'string' ? `${connectionSlug}.${label}` : label;
    }
    case 'action':
      return step.action.name;
    case 'composite':
      return step.composite.name;
    default:
      return assertNever(step);
  }
}

function firstLine(value: string): string {
  return value.split(FIRST_LINE_PATTERN, 1)[0]?.trim() || value.trim();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workflow step kind: ${JSON.stringify(value)}`);
}
