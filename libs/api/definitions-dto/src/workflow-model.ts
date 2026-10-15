import type {
  ExpressionType,
  OutputDeclarations,
  OutputTypeDeclaration,
  ResolvedFieldSegment,
  WorkflowExpression,
} from '@shipfox/expression';
import type {AgentToolSurface, Harness} from '@shipfox/workflow-document';
import {z} from 'zod';

export const DEFAULT_RUN_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_JOB_SUCCESS = "!executions.exists(e, e.status == 'failed')";

export interface WorkflowModelCheckoutTemplates {
  readonly project?: WorkflowFieldTemplate;
  readonly connection?: WorkflowFieldTemplate;
  readonly repository?: WorkflowFieldTemplate;
  readonly ref?: WorkflowFieldTemplate;
  readonly path?: WorkflowFieldTemplate;
}

export type WorkflowModelCheckoutTargetKey = keyof WorkflowModelCheckoutTemplates;

export const WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS = [
  ['project', 'checkout.project'],
  ['connection', 'checkout.connection'],
  ['repository', 'checkout.repository'],
  ['ref', 'checkout.ref'],
  ['path', 'checkout.path'],
] as const satisfies readonly (readonly [
  WorkflowModelCheckoutTargetKey,
  `checkout.${WorkflowModelCheckoutTargetKey}`,
])[];

export interface WorkflowModelCheckout {
  readonly project?: string;
  readonly connection?: string;
  readonly repository?: string;
  readonly ref?: string;
  readonly fetchDepth: number;
  readonly path?: string;
  readonly permissions: {readonly contents: 'read' | 'write'};
  readonly persistCredentials: boolean;
  readonly force?: boolean;
  readonly templates?: WorkflowModelCheckoutTemplates;
}

export type WorkflowModelJobCheckout = Pick<
  WorkflowModelCheckout,
  'permissions' | 'persistCredentials'
>;

export interface WorkflowModelStepCheckout extends WorkflowModelCheckout {}

export const DEFAULT_JOB_CHECKOUT: WorkflowModelJobCheckout = {
  permissions: {contents: 'read'},
  persistCredentials: true,
};

export type WorkflowFieldTemplate = readonly ResolvedFieldSegment[];
export type WorkflowEnvTemplates = Readonly<Record<string, WorkflowFieldTemplate>>;
export type WorkflowOutputTemplates = Readonly<Record<string, WorkflowFieldTemplate>>;

/** The step output that a job output promotes through a step `export`. */
export interface WorkflowExportedOutput {
  readonly stepKey: string;
  readonly output: string;
}

export interface WorkflowModelConcurrency {
  readonly group: WorkflowFieldTemplate;
  readonly scope: 'workflow' | 'project';
  readonly cancelInProgress: boolean;
}

/** A JSON-compatible value tree, the shape of a tool step's `with` payload. */
export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly WorkflowJsonValue[]
  | {readonly [key: string]: WorkflowJsonValue};

/**
 * A mirror of the `with` tree where every interpolated string leaf is replaced
 * by its parsed template. Fully-literal children are pruned: object entries
 * without a template disappear from the tree, while arrays keep positional
 * `undefined` so indices stay aligned with the authored payload.
 */
export type WorkflowJsonTemplateTree =
  | WorkflowFieldTemplate
  | readonly (WorkflowJsonTemplateTree | undefined)[]
  | {readonly [key: string]: WorkflowJsonTemplateTree | undefined};

export interface WorkflowModel {
  readonly kind: 'workflow';
  readonly name: string;
  readonly runName?: WorkflowFieldTemplate;
  readonly concurrency?: WorkflowModelConcurrency;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {readonly env?: WorkflowEnvTemplates};
  readonly triggers: readonly WorkflowModelTrigger[];
  readonly jobs: readonly WorkflowModelJob[];
  readonly dependencies: readonly WorkflowModelDependency[];
  readonly outputs?: WorkflowOutputTemplates;
  readonly outputTypes?: Readonly<Record<string, ExpressionType>>;
}

export interface WorkflowModelTrigger {
  readonly id: string;
  readonly key: string;
  readonly source: string;
  readonly event?: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly filter?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * A job container. Each field keeps its authored text. A field with `${{ }}`
 * interpolation also has a template under `templates`, filled when the field
 * is needed: the image and options at execution creation, the credentials and
 * env values on the runner.
 */
export interface WorkflowModelJobContainer {
  readonly image: string;
  readonly credentials?: {readonly username: string; readonly password: string};
  readonly env?: Readonly<Record<string, string>>;
  readonly options?: string;
  readonly dockerSocket: boolean;
  readonly templates?: {
    readonly image?: WorkflowFieldTemplate;
    readonly options?: WorkflowFieldTemplate;
    readonly username?: WorkflowFieldTemplate;
    readonly password?: WorkflowFieldTemplate;
    readonly env?: WorkflowEnvTemplates;
  };
}

export type WorkflowModelRunAfter = 'success' | 'failure' | 'always';

export interface WorkflowModelJob {
  readonly id: string;
  readonly key: string;
  readonly mode: 'one_shot' | 'listening';
  readonly runner: readonly string[];
  readonly runnerTemplates?: readonly WorkflowFieldTemplate[];
  readonly checkout: WorkflowModelJobCheckout | false;
  readonly container?: WorkflowModelJobContainer;
  readonly if?: WorkflowExpression;
  /** Models stored before `run_after` omit it and mean `always` with an `if`, `success` without. */
  readonly runAfter?: WorkflowModelRunAfter;
  readonly success?: string;
  readonly outputs?: WorkflowOutputTemplates;
  readonly outputTypes?: Readonly<Record<string, ExpressionType>>;
  /** Job outputs that come from a step `export`, by job output name. A missing source omits the output. */
  readonly exportedOutputs?: Readonly<Record<string, WorkflowExportedOutput>>;
  readonly executionTimeoutMs?: number;
  readonly listening?: WorkflowModelJobListening;
  readonly name?: string;
  readonly executionName?: WorkflowFieldTemplate;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {readonly env?: WorkflowEnvTemplates};
  readonly dependencies: readonly string[];
  readonly steps: readonly WorkflowModelStep[];
}

export interface WorkflowModelJobListening {
  readonly on: readonly WorkflowModelListeningTrigger[];
  readonly until?: readonly WorkflowModelListeningTrigger[];
  readonly timeoutMs?: number;
  readonly maxExecutions?: number;
  readonly batch?: WorkflowModelListeningBatch;
  readonly onResolve: 'finish' | 'cancel';
}
export interface WorkflowModelListeningTrigger {
  readonly source: string;
  readonly event?: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly filter?: string;
}
export interface WorkflowModelListeningBatch {
  readonly debounceMs?: number;
  readonly maxSize?: number;
  readonly maxWaitMs?: number;
}
export type WorkflowModelStep =
  | WorkflowModelRunStep
  | WorkflowModelAgentStep
  | WorkflowModelCheckoutStep
  | WorkflowModelToolStep
  | WorkflowModelActionStep
  | WorkflowModelCompositeStep;
interface WorkflowModelStepBase {
  readonly id: string;
  readonly key?: string;
  readonly if?: WorkflowExpression;
  /** Models stored before `run_after` omit it and mean `always` with an `if`, `success` without. */
  readonly runAfter?: WorkflowModelRunAfter;
  readonly name?: string;
  readonly workingDirectory?: string;
  readonly outputs?: OutputDeclarations;
  readonly gate?: WorkflowModelStepGate;
  readonly sourceLocation?: WorkflowSourceLocation;
}
export interface WorkflowModelRunStep extends WorkflowModelStepBase {
  readonly kind: 'run';
  readonly command: {readonly kind: 'shell'; readonly value: string};
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {
    readonly command?: WorkflowFieldTemplate;
    readonly name?: WorkflowFieldTemplate;
    readonly workingDirectory?: WorkflowFieldTemplate;
    readonly env?: WorkflowEnvTemplates;
  };
}
/** Each toggle is authored as a boolean, or as a template source resolved when the step dispatches. */
export interface WorkflowModelAgentRepositoryContext {
  readonly instructions?: boolean | string;
  readonly skills?: boolean | string | readonly string[];
}
/**
 * A stdio MCP server that the runner starts for an agent step. `command` and `args` are literal.
 * An `env` value with `${{ }}` interpolation also has a template under `templates`, filled at
 * dispatch or, for secrets, on the runner.
 */
export interface WorkflowModelAgentMcpServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly include?: readonly string[];
  readonly templates?: {readonly env?: WorkflowEnvTemplates};
}
export interface WorkflowModelAgentStep extends WorkflowModelStepBase {
  readonly kind: 'agent';
  readonly harness?: Harness;
  readonly model?: string;
  readonly provider?: string;
  /** An authored level, or a template source resolved when the step dispatches. */
  readonly thinking?: string;
  readonly tools?: readonly string[];
  readonly toolSurface?: AgentToolSurface;
  readonly integrations?: readonly WorkflowModelStepIntegration[];
  readonly customMcpServers?: readonly WorkflowModelAgentMcpServer[];
  readonly prompt: string;
  readonly session?: WorkflowModelAgentStepSession;
  readonly repositoryContext?: WorkflowModelAgentRepositoryContext;
  readonly templates?: {
    readonly prompt?: WorkflowFieldTemplate;
    readonly model?: WorkflowFieldTemplate;
    readonly provider?: WorkflowFieldTemplate;
    readonly thinking?: WorkflowFieldTemplate;
    readonly repositoryContextInstructions?: WorkflowFieldTemplate;
    readonly repositoryContextSkills?: WorkflowFieldTemplate;
    readonly workingDirectory?: WorkflowFieldTemplate;
    readonly name?: WorkflowFieldTemplate;
  };
}
export interface WorkflowModelCheckoutStep extends WorkflowModelStepBase {
  readonly kind: 'checkout';
  readonly checkout: WorkflowModelStepCheckout;
  readonly templates?: {
    readonly workingDirectory?: WorkflowFieldTemplate;
    readonly name?: WorkflowFieldTemplate;
  };
}
export interface WorkflowModelToolStep extends WorkflowModelStepBase {
  readonly kind: 'tool';
  /** `id` is the standalone tool id; `method` is set when the author named `family.method`. */
  readonly tool: {readonly id: string; readonly method?: string};
  readonly connection?: string;
  readonly with?: WorkflowJsonValue;
  /** Authored output mappings: each value is a single expression over `result` and `vars`. */
  readonly outputMappings?: Readonly<Record<string, WorkflowExpression>>;
  readonly templates?: {
    readonly with?: WorkflowJsonTemplateTree;
    readonly name?: WorkflowFieldTemplate;
  };
}
export interface WorkflowModelActionStep extends WorkflowModelStepBase {
  readonly kind: 'action';
  readonly action: WorkflowModelAction;
  readonly with?: WorkflowJsonValue;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {
    readonly with?: WorkflowJsonTemplateTree;
    readonly name?: WorkflowFieldTemplate;
    readonly workingDirectory?: WorkflowFieldTemplate;
    readonly env?: WorkflowEnvTemplates;
  };
}
/** The action snapshot a step runs, with the manifest fields dispatch needs. */
export interface WorkflowModelAction {
  readonly uses: string;
  /** Where the action comes from. Models stored before registry actions omit it and mean `local`. */
  readonly origin?: 'local' | 'registry';
  /** Registry package name, such as `shipfox/slack-thread-digest`. Set when `origin` is `registry`. */
  readonly package?: string;
  /** Exact registry version. Set when `origin` is `registry`. */
  readonly version?: string;
  readonly digest: string;
  readonly name: string;
  readonly main: string;
  /** Entry file for the end of the job. Models stored before posts omit it, and no post runs. */
  readonly post?: string;
  /** What a failed post does to the job. Set when `post` is set. */
  readonly postFailure?: 'warn' | 'fail';
  readonly inputs: Readonly<Record<string, WorkflowModelActionInput>>;
  /** Keyed by manifest alias. Each alias is bound to a connection slug by the step. */
  readonly integrations: Readonly<Record<string, WorkflowModelActionIntegration>>;
}
export interface WorkflowModelActionInput extends OutputTypeDeclaration {
  readonly required: boolean;
  /** Applies only when the step omits the input. */
  readonly default?: WorkflowJsonValue;
  /**
   * Set on a composite action input that receives a secret. Its inner uses are
   * rewritten to the caller's secret reference, so it never has a value.
   */
  readonly secret?: true;
}
export interface WorkflowModelActionIntegration {
  readonly provider: string;
  readonly connection: string;
  readonly include: readonly string[];
  readonly allowWrite: boolean;
}
/**
 * A composite action step. Its inner steps are normalized for this use: their
 * ids are path ids under `id`, they read the composite's `inputs`, their own
 * `steps`, and `action`, and their integrations hold plain connection slugs.
 * The step's `env` and `workingDirectory` are the base for the inner steps,
 * which override them.
 */
export interface WorkflowModelCompositeStep extends WorkflowModelStepBase {
  readonly kind: 'composite';
  readonly composite: WorkflowModelComposite;
  /** The authored `with`, without the secret inputs, which are rewritten into the inner steps. */
  readonly with?: WorkflowJsonValue;
  readonly env?: Readonly<Record<string, string>>;
  readonly steps: readonly WorkflowModelStep[];
  readonly templates?: {
    readonly with?: WorkflowJsonTemplateTree;
    readonly name?: WorkflowFieldTemplate;
    readonly workingDirectory?: WorkflowFieldTemplate;
    readonly env?: WorkflowEnvTemplates;
  };
}
/** The composite action snapshot a step expands, with the manifest fields the run engine needs. */
export interface WorkflowModelComposite {
  readonly uses: string;
  readonly origin: 'local' | 'registry';
  /** Registry package name. Set when `origin` is `registry`. */
  readonly package?: string;
  /** Exact registry version. Set when `origin` is `registry`. */
  readonly version?: string;
  readonly digest: string;
  readonly name: string;
  readonly inputs: Readonly<Record<string, WorkflowModelActionInput>>;
  /** Each output's declaration and its `value`, filled when the composite closes. */
  readonly outputs: Readonly<Record<string, WorkflowModelCompositeOutput>>;
  /** Keyed by manifest alias. Each alias is bound to a connection slug by the step. */
  readonly integrations: Readonly<Record<string, WorkflowModelActionIntegration>>;
}
export interface WorkflowModelCompositeOutput {
  readonly declaration: OutputTypeDeclaration & {readonly required: boolean};
  readonly value: WorkflowFieldTemplate;
}
export interface WorkflowModelStepIntegration {
  readonly connection?: string;
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
  readonly allowWrite: boolean;
}
/** A session key template plus the step's mode for that session. */
export interface WorkflowModelAgentStepSession {
  readonly key: WorkflowFieldTemplate;
  readonly mode: 'resume' | 'fork';
  /**
   * Set on an agent step inside a composite action whose key is not exactly
   * `${{ inputs.<name> }}`: the id of the composite use. The run engine
   * derives the stored key from it, so two uses never share a session.
   */
  readonly scope?: string;
}
export interface WorkflowSourceLocation {
  readonly startLine: number;
  readonly endLine: number;
  /** The file that holds the lines. Absent means the workflow file. */
  readonly file?: WorkflowSourceFile;
}
/** A composite action's manifest, the file that holds its inner steps. */
export interface WorkflowSourceFile {
  readonly kind: 'action';
  readonly uses: string;
  readonly digest: string;
  /** The manifest path inside the action directory, `action.yml` or `action.yaml`. */
  readonly path: string;
}
export type WorkflowStepSourceLocationMap = ReadonlyMap<
  string,
  ReadonlyMap<number, WorkflowSourceLocation>
>;
export interface WorkflowModelStepGate {
  readonly success?: WorkflowExpression;
  /** One rule, or an ordered list where the first rule that applies drives a restart. A tool step restarts only when its call reads. */
  readonly onFailure?: WorkflowModelStepFailureAction | readonly WorkflowModelStepFailureAction[];
}
/** Reads `onFailure` as a rule list; one rule is a one-rule list. */
export function gateFailureRules(
  onFailure: WorkflowModelStepGate['onFailure'],
): readonly WorkflowModelStepFailureAction[] {
  if (onFailure === undefined) return [];
  return 'restartFrom' in onFailure ? [onFailure] : onFailure;
}
export interface WorkflowModelStepFailureAction {
  /** Selects the rule when it returns true. A rule with no condition always applies. */
  readonly if?: WorkflowExpression;
  readonly restartFrom: string;
  readonly feedback?: string;
  readonly feedbackTemplate?: WorkflowFieldTemplate;
  /** Optional for legacy v2 and v3 snapshots that predate persisted gate limits. */
  readonly maxAttempts?: number;
}
export interface WorkflowModelDependency {
  readonly from: string;
  readonly to: string;
}
export interface WorkflowSourceSnapshot {
  readonly content: string;
  readonly format: 'yaml';
}

const workflowModelSchema = z.custom<WorkflowModel>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as {kind?: unknown}).kind === 'workflow',
  {message: 'Expected a normalized workflow model'},
);

export const workflowModelSnapshotSchema = z.object({
  // v2 snapshots predate tool steps, v3 snapshots predate concurrency, v4
  // snapshots predate job containers, and v5 snapshots predate composite
  // actions. Historical versions stay readable while snapshots containing a
  // composite step use v6, then a job container v5, then concurrency v4.
  version: z.union([z.literal(6), z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  model: workflowModelSchema,
});
export type WorkflowModelSnapshot = z.infer<typeof workflowModelSnapshotSchema>;

export function createWorkflowModelSnapshot(model: WorkflowModel): WorkflowModelSnapshot {
  if (model.jobs.some((job) => job.steps.some((step) => step.kind === 'composite'))) {
    return {version: 6, model};
  }
  if (model.jobs.some((job) => job.container !== undefined)) return {version: 5, model};
  return {version: model.concurrency === undefined ? 3 : 4, model};
}

/**
 * The steps of a job in run order: each composite step, then its inner steps,
 * nested composites inline. A materialized step row's position is its index
 * here plus one, after the setup step at position 0.
 */
export function flattenJobSteps(job: Pick<WorkflowModelJob, 'steps'>): WorkflowModelStep[] {
  const steps: WorkflowModelStep[] = [];
  const pending: WorkflowModelStep[] = [...job.steps].reverse();
  while (pending.length > 0) {
    const step = pending.pop();
    if (step === undefined) continue;
    steps.push(step);
    if (step.kind === 'composite') {
      for (let index = step.steps.length - 1; index >= 0; index -= 1) {
        const inner = step.steps[index];
        if (inner !== undefined) pending.push(inner);
      }
    }
  }
  return steps;
}

export function workflowModelFromSnapshot(snapshot: WorkflowModelSnapshot): WorkflowModel {
  switch (snapshot.version) {
    // Historical snapshots carry older model shapes; optional model fields
    // make them readable as-is.
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return snapshot.model;
    default:
      // Callers that bypass the zod boundary (or a future version) get a
      // diagnostic naming the received version instead of a silent undefined.
      throw new Error(
        `Unsupported workflow model snapshot version ${String(
          snapshot.version,
        )}; supported versions are 2, 3, 4, 5, and 6.`,
      );
  }
}

/** Reads both current snapshots and the unversioned attempt rows written before snapshots existed. */
export function readPersistedWorkflowModel(
  value: WorkflowModel | WorkflowModelSnapshot,
): WorkflowModel {
  if ('version' in value)
    return workflowModelFromSnapshot(workflowModelSnapshotSchema.parse(value));
  return workflowModelSchema.parse(value);
}
