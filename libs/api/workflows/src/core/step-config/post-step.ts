import type {StepEnvSourceDto} from '@shipfox/api-workflows-dto';
import type {Step, StepAttempt} from '#core/entities/step.js';

/** What a post row remembers about the action step that declared it. */
export interface PostStepConfig {
  readonly main_position: number;
  readonly failure: 'warn' | 'fail';
}

export interface PostStateSource {
  readonly position: number;
  readonly attempt: number;
}

// Config keys the post takes from the selected main attempt. The bindings are references, never
// values, so copying them copies no secret.
const INHERITED_MAIN_CONFIG_KEYS = [
  'inputs',
  'env',
  'secret_bindings',
  'working_directory',
] as const;

/**
 * An attempt row does not prove that the action ran: a failed condition or an unresolvable config
 * inserts a failed attempt that the runner never receives. Every attempt the server delivered
 * stores its resolved config, so a null config means the runner never saw it.
 */
export function attemptWasDelivered<T extends Pick<StepAttempt, 'config'>>(
  attempt: T,
): attempt is T & {config: Record<string, unknown>} {
  return attempt.config !== null;
}

export function readPostStepConfig(config: Readonly<Record<string, unknown>>): PostStepConfig {
  const post = config.post;
  if (post === null || typeof post !== 'object' || Array.isArray(post)) {
    throw new Error('Post step config is missing its post settings');
  }
  const {main_position: mainPosition, failure} = post as Record<string, unknown>;
  if (typeof mainPosition !== 'number' || (failure !== 'warn' && failure !== 'fail')) {
    throw new Error('Post step config has invalid post settings');
  }
  return {main_position: mainPosition, failure};
}

export type PostStart =
  | {kind: 'skip'}
  | {kind: 'run'; mainStep: Step; mainAttempt: StepAttempt & {config: Record<string, unknown>}};

/**
 * Picks the attempt of the main step that the post runs for: the delivered attempt with the
 * highest number. It is not always the current attempt, because a gate restart can leave the main
 * step skipped or with an attempt that failed config resolution.
 */
export function selectPostMainAttempt(params: {
  readonly post: Pick<Step, 'config'>;
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
}): PostStart {
  const {main_position: mainPosition} = readPostStepConfig(params.post.config);
  const mainStep = params.steps.find((step) => step.position === mainPosition);
  if (mainStep === undefined) return {kind: 'skip'};

  let selected: (StepAttempt & {config: Record<string, unknown>}) | undefined;
  for (const attempt of params.attempts) {
    if (attempt.stepId !== mainStep.id || !attemptWasDelivered(attempt)) continue;
    if (selected === undefined || attempt.attempt > selected.attempt) selected = attempt;
  }
  return selected === undefined ? {kind: 'skip'} : {kind: 'run', mainStep, mainAttempt: selected};
}

/**
 * The config a post is dispatched with: its own action and grants, plus what the selected main
 * attempt ran with.
 */
export function buildPostDispatchConfig(params: {
  readonly post: Pick<Step, 'config'>;
  readonly mainAttempt: Pick<StepAttempt, 'attempt' | 'status'> & {
    readonly config: Record<string, unknown>;
  };
  readonly mainPosition: number;
  readonly executionFailed: boolean;
}): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};
  for (const key of INHERITED_MAIN_CONFIG_KEYS) {
    const value = params.mainAttempt.config[key];
    if (value !== undefined) inherited[key] = value;
  }
  const stateSource: PostStateSource = {
    position: params.mainPosition,
    attempt: params.mainAttempt.attempt,
  };
  // Only the creation-time keys carry over, so a re-run row that kept an earlier dispatch's
  // inputs or state source cannot leak them.
  const {post, action, job_key: jobKey, integrations} = params.post.config;
  return {
    post,
    action,
    job_key: jobKey,
    integrations,
    ...inherited,
    state_source: stateSource,
    post_context: {
      execution_failed: params.executionFailed,
      main_status: params.mainAttempt.status === 'succeeded' ? 'succeeded' : 'failed',
    },
  };
}

export function readPostStateSource(
  config: Readonly<Record<string, unknown>>,
): PostStateSource | undefined {
  const source = config.state_source;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const {position, attempt} = source as Record<string, unknown>;
  if (typeof position !== 'number' || typeof attempt !== 'number') return undefined;
  return {position, attempt};
}

/**
 * The list names the current attempt of each earlier step, so a main step that a restart skipped
 * or rewound would lose the exports of the attempt the post runs for. Setting the main entry to
 * that attempt keeps its place in the position order, which decides who wins a shared variable.
 */
export function withPostMainAttempt(
  sources: readonly StepEnvSourceDto[],
  post: Pick<Step, 'config'>,
): StepEnvSourceDto[] {
  const selected = readPostStateSource(post.config);
  if (selected === undefined) return [...sources];
  const others = sources.filter((source) => source.position !== selected.position);
  return [...others, selected].sort((left, right) => left.position - right.position);
}
