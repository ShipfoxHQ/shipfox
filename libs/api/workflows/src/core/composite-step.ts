import {createHash} from 'node:crypto';
import {actionBundleDirectoryName, WORKFLOW_SESSION_KEY_PATTERN} from '@shipfox/workflow-document';
import type {Step, StepAttempt} from './entities/step.js';
import {AgentStepSessionClaimError, boundedStepName} from './errors.js';
import {isTerminal, stepAffectsConclusion} from './step-transition/decide-step-transition.js';

/** The composite action step that holds `step`, or undefined for a job step. */
export function parentStepOf(step: Step, steps: readonly Step[]): Step | undefined {
  if (step.parentStepId === null) return undefined;
  return steps.find((candidate) => candidate.id === step.parentStepId);
}

export type StepPathNode = Pick<Step, 'id' | 'parentStepId' | 'key' | 'name' | 'position'>;

/** The composite action steps that hold `step`, outermost first. */
export function compositeAncestorsOf<T extends StepPathNode>(step: T, steps: readonly T[]): T[] {
  const stepById = new Map(steps.map((candidate) => [candidate.id, candidate]));
  const ancestors: T[] = [];
  let parent = step.parentStepId === null ? undefined : stepById.get(step.parentStepId);
  while (parent !== undefined && !ancestors.includes(parent)) {
    ancestors.unshift(parent);
    parent = parent.parentStepId === null ? undefined : stepById.get(parent.parentStepId);
  }
  return ancestors;
}

/**
 * Names a step the way the run page labels an inner step: one label per composite that holds it,
 * outermost first, then the step itself. A job step has only its own label.
 */
export function stepPath(step: StepPathNode, ancestors: readonly StepPathNode[]): string[] {
  return [...ancestors, step].map(
    (node) => node.key?.trim() || node.name.trim() || `Step ${node.position + 1}`,
  );
}

/** A step path as prose, such as `setup › lint`. */
export function stepPathLabel(path: readonly string[]): string {
  return path.map(boundedStepName).join(' › ');
}

/** The attempt the composite's current pass opened. Its config holds the resolved inputs. */
export function openedCompositeAttempt(
  composite: Step,
  attempts: readonly StepAttempt[],
): StepAttempt | undefined {
  return attempts.find(
    (attempt) => attempt.stepId === composite.id && attempt.attempt === composite.currentAttempt,
  );
}

/**
 * The running composite whose inner steps have all finished, innermost first. A running nested
 * composite is not terminal, so only the innermost composite of a chain can close.
 */
export function closableComposite(steps: readonly Step[]): Step | undefined {
  return steps
    .filter((step) => step.type === 'composite' && step.status === 'running')
    .filter((composite) =>
      steps.every((step) => step.parentStepId !== composite.id || isTerminal(step.status)),
    )
    .at(-1);
}

/** A failed inner step fails its composite, unless it is a post that only warns. */
export function compositeFailed(composite: Step, steps: readonly Step[]): boolean {
  return steps.some(
    (step) =>
      step.parentStepId === composite.id && step.status === 'failed' && stepAffectsConclusion(step),
  );
}

/**
 * Inside a composite, `run_after` looks at the earlier inner steps of the same use only. A job
 * step keeps the job-wide meaning, `execution.failed`.
 */
export function earlierSiblingFailed(step: Step, steps: readonly Step[]): boolean {
  return steps.some(
    (candidate) =>
      candidate.parentStepId === step.parentStepId &&
      candidate.position < step.position &&
      candidate.status === 'failed' &&
      stepAffectsConclusion(candidate),
  );
}

/** Where the runner unpacked the composite's files, with the directory name it uses. */
export function compositeActionPath(actionsDir: string, digest: string): string {
  return `${actionsDir}/${actionBundleDirectoryName(digest)}`;
}

export function compositeDigest(composite: Step): string | undefined {
  const config = composite.config.composite;
  if (config === null || typeof config !== 'object') return undefined;
  const digest = (config as Record<string, unknown>).digest;
  return typeof digest === 'string' ? digest : undefined;
}

/** The roots an inner step reads from its composite: `inputs` and `action`. */
export function compositeScopeValues(params: {
  readonly composite: Step;
  readonly attempts: readonly StepAttempt[];
  readonly actionsDir: string | null | undefined;
}): Record<string, unknown> {
  const inputs = openedCompositeAttempt(params.composite, params.attempts)?.config?.inputs;
  const digest = compositeDigest(params.composite);
  return {
    inputs: inputs !== null && typeof inputs === 'object' ? inputs : {},
    ...(params.actionsDir === null || params.actionsDir === undefined || digest === undefined
      ? {}
      : {action: {path: compositeActionPath(params.actionsDir, digest)}}),
  };
}

const INHERITED_ENV_STEP_TYPES: ReadonlySet<Step['type']> = new Set(['run', 'action']);
const INHERITED_WORKING_DIRECTORY_STEP_TYPES: ReadonlySet<Step['type']> = new Set([
  'run',
  'action',
  'agent',
  'composite',
]);

/** Whether a step reads anything its composite resolved when it opened. */
export function inheritsCompositeConfig(step: Step, compositeConfig: Record<string, unknown>) {
  const env = INHERITED_ENV_STEP_TYPES.has(step.type) || step.type === 'composite';
  return (
    step.config.composite_inherited !== undefined ||
    (env && (compositeConfig.env !== undefined || compositeConfig.secret_bindings !== undefined)) ||
    (INHERITED_WORKING_DIRECTORY_STEP_TYPES.has(step.type) &&
      compositeConfig.working_directory !== undefined)
  );
}

/**
 * Adds what the composite resolved when it opened, in the caller's scope: its env and env
 * secrets for the keys the step does not set, and its working directory when the step has none.
 * Nested composites stack, since each one opens with its parent's values as the base.
 *
 * The dispatched config is stored on the step, and a restart dispatches from it again. So the
 * config records what it inherited, and the next pass drops those values before it inherits the
 * values the composite opened with this time.
 */
export function withCompositeConfig(params: {
  readonly stepType: Step['type'];
  readonly config: Record<string, unknown>;
  readonly compositeConfig: Record<string, unknown>;
}): Record<string, unknown> {
  const {compositeConfig} = params;
  const previous = readInherited(params.config.composite_inherited);
  const {composite_inherited: _previous, ...result} = params.config;
  const inherited: {env: string[]; working_directory: boolean} = {
    env: [],
    working_directory: false,
  };

  if (INHERITED_ENV_STEP_TYPES.has(params.stepType) || params.stepType === 'composite') {
    const env = Object.fromEntries(
      Object.entries(recordOf(result.env)).filter(([key]) => !previous.env.includes(key)),
    );
    const bindings = arrayOf(result.secret_bindings).filter((binding) =>
      envTarget(binding).every((key) => !previous.env.includes(key)),
    );
    const ownKeys = new Set([...Object.keys(env), ...bindings.flatMap(envTarget)]);
    const inheritedEnv = Object.fromEntries(
      Object.entries(recordOf(compositeConfig.env)).filter(([key]) => !ownKeys.has(key)),
    );
    const inheritedBindings = arrayOf(compositeConfig.secret_bindings).filter((binding) => {
      const keys = envTarget(binding);
      return keys.length > 0 && keys.every((key) => !ownKeys.has(key));
    });
    const mergedEnv = {...inheritedEnv, ...env};
    delete result.env;
    delete result.secret_bindings;
    if (Object.keys(mergedEnv).length > 0) result.env = mergedEnv;
    const mergedBindings = [...inheritedBindings, ...bindings];
    if (mergedBindings.length > 0) result.secret_bindings = mergedBindings;
    inherited.env = [...Object.keys(inheritedEnv), ...inheritedBindings.flatMap(envTarget)];
  }

  if (previous.working_directory) delete result.working_directory;
  if (
    INHERITED_WORKING_DIRECTORY_STEP_TYPES.has(params.stepType) &&
    result.working_directory === undefined &&
    compositeConfig.working_directory !== undefined
  ) {
    result.working_directory = compositeConfig.working_directory;
    inherited.working_directory = true;
  }

  if (inherited.env.length > 0 || inherited.working_directory) {
    result.composite_inherited = inherited;
  }
  return result;
}

function readInherited(value: unknown): {env: readonly string[]; working_directory: boolean} {
  const record = recordOf(value);
  const env = arrayOf(record.env).filter((key): key is string => typeof key === 'string');
  return {env, working_directory: record.working_directory === true};
}

function envTarget(binding: unknown): string[] {
  if (binding === null || typeof binding !== 'object') return [];
  const target = (binding as Record<string, unknown>).target;
  return typeof target === 'string' ? [target] : [];
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const SCOPED_SESSION_KEY_PREFIX_LENGTH = 95;
const SCOPED_SESSION_KEY_HASH_LENGTH = 32;

/**
 * The stored key of an agent session inside a composite: the authored key as a readable prefix,
 * then a hash of the composite use, so two uses never share a session. The result stays within
 * the session key grammar.
 */
export function scopedSessionKey(key: string, scope: string | undefined): string {
  if (scope === undefined) return key;
  if (!WORKFLOW_SESSION_KEY_PATTERN.test(key)) {
    throw new AgentStepSessionClaimError(
      'agent_session_key_invalid',
      'Agent session key is invalid',
    );
  }
  const hash = createHash('sha256')
    .update(`${scope}\n${key}`)
    .digest('hex')
    .slice(0, SCOPED_SESSION_KEY_HASH_LENGTH);
  return `${key.slice(0, SCOPED_SESSION_KEY_PREFIX_LENGTH)}.${hash}`;
}

export function sessionScopeOf(config: Record<string, unknown>): string | undefined {
  const scope = config.session_scope;
  return typeof scope === 'string' && scope.length > 0 ? scope : undefined;
}
