import type {Step, StepAttempt} from './entities/step.js';
import {isTerminal} from './step-transition/decide-step-transition.js';

/** An attempt the runner is executing at the moment it asks for the next step. */
export interface InFlightStep {
  readonly stepId: string;
  readonly attempt: number;
}

/** What the scheduler needs to know about the runner that asked and about the deployment. */
export interface StepScheduling {
  readonly inFlight: readonly InFlightStep[];
  /** Most steps of one job that run at the same time. */
  readonly maxConcurrentSteps: number;
}

export const TOOL_STEP_RETRY_AFTER_MS = 1000;
/** A safety net when every blocker runs on the runner, which wakes early when one of its steps ends. */
export const RUNNER_STEP_RETRY_AFTER_MS = 30_000;

/** Steps the server resolves on its own, without a runner. */
const SERVER_RUN_STEP_TYPES: ReadonlySet<Step['type']> = new Set([
  'tool',
  'composite',
  'wait',
  'cancel',
]);

export function isRunnerStep(step: Pick<Step, 'type'>): boolean {
  return !SERVER_RUN_STEP_TYPES.has(step.type);
}

export function holdsAttempt(
  inFlight: readonly InFlightStep[],
  attempt: {readonly stepId: string; readonly attempt: number},
): boolean {
  return inFlight.some(
    (entry) => entry.stepId === attempt.stepId && entry.attempt === attempt.attempt,
  );
}

export function isHeldByRunner(
  inFlight: readonly InFlightStep[],
  step: Pick<Step, 'id' | 'currentAttempt'>,
): boolean {
  return holdsAttempt(inFlight, {stepId: step.id, attempt: step.currentAttempt});
}

/**
 * How long the runner waits before it asks again. A server-run blocker, which no runner event
 * announces, is polled at 1000 ms. Otherwise the runner wakes when one of its own steps ends.
 */
export function retryAfterMs(blockers: readonly Pick<Step, 'type'>[]): number {
  if (blockers.length === 0) return TOOL_STEP_RETRY_AFTER_MS;
  return blockers.some((blocker) => !isRunnerStep(blocker))
    ? TOOL_STEP_RETRY_AFTER_MS
    : RUNNER_STEP_RETRY_AFTER_MS;
}

export type ScanAction =
  | {readonly kind: 'idle'}
  | {readonly kind: 'blocked'; readonly blockers: readonly Step[]}
  | {readonly kind: 'wait'; readonly step: Step}
  | {readonly kind: 'cancel'; readonly step: Step}
  | {readonly kind: 'pending'; readonly step: Step};

/**
 * The first thing the job has to do, scanning by position. A running composite is open on the
 * server and its inner steps follow it. A running background step lets the steps after it start;
 * any other running step blocks them. A wait row is a barrier until every target is terminal.
 */
export function nextScanAction(steps: readonly Step[]): ScanAction {
  const background: Step[] = [];
  for (const step of steps) {
    const action = openStepAction(step);
    if (action === undefined) continue;
    if (action.kind === 'background') {
      background.push(step);
      continue;
    }
    return action;
  }
  // Nothing is left to start, but the job is not done while a background step still runs.
  return background.length === 0 ? {kind: 'idle'} : {kind: 'blocked', blockers: background};
}

function openStepAction(step: Step): ScanAction | {readonly kind: 'background'} | undefined {
  if (isTerminal(step.status)) return undefined;
  if (step.type === 'composite' && step.status === 'running') return undefined;
  if (step.type === 'wait') return {kind: 'wait', step};
  if (step.type === 'cancel') return {kind: 'cancel', step};
  if (step.status !== 'running') return {kind: 'pending', step};
  return step.background ? {kind: 'background'} : {kind: 'blocked', blockers: [step]};
}

/** The steps a wait or cancel row names, by position. */
export function controlStepTargets(step: Pick<Step, 'config'>, steps: readonly Step[]): Step[] {
  const targets = step.config.targets;
  if (!Array.isArray(targets)) return [];
  const positions = new Set(targets.filter((target) => typeof target === 'number'));
  return steps.filter((candidate) => positions.has(candidate.position));
}

/** The targets and every step inside a target that is a composite action. */
export function withInnerSteps(targets: readonly Step[], steps: readonly Step[]): Step[] {
  const included = new Set(targets.map((target) => target.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const step of steps) {
      if (step.parentStepId === null || included.has(step.id)) continue;
      if (!included.has(step.parentStepId)) continue;
      included.add(step.id);
      grew = true;
    }
  }
  return steps.filter((step) => included.has(step.id));
}

/** Attempts that a cancel step asked to stop and whose process the runner has not confirmed gone. */
export function stoppingAttempts(attempts: readonly StepAttempt[]): StepAttempt[] {
  return attempts.filter(
    (attempt) => attempt.status === 'running' && attempt.cancelRequestedAt !== null,
  );
}

function stepsOfAttempts(attempts: readonly StepAttempt[], steps: readonly Step[]): Step[] {
  const ids = new Set(attempts.map((attempt) => attempt.stepId));
  return steps.filter((step) => ids.has(step.id));
}

/**
 * Whether a wait fails. A target that failed without `continue_on_error` fails it. This is not
 * `stepAffectsConclusion`, which leaves every background step out and would let each join pass.
 */
export function failedWaitTargets(targets: readonly Step[]): Step[] {
  return targets.filter((target) => target.status === 'failed' && !target.continueOnError);
}

/**
 * The steps that keep `pending` from starting now. A stopping process still holds its files, so a
 * checkout and a post wait for every stopping process, and a step waits for the stopping attempt
 * of its own earlier pass. After that, the steps already running fill the deployment limit.
 */
export function dispatchBlockers(params: {
  readonly pending: Step;
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly maxConcurrentSteps: number;
}): Step[] {
  const {pending} = params;
  const stopping = stoppingAttempts(params.attempts);
  const barrier =
    pending.type === 'checkout' || pending.type === 'post'
      ? stopping
      : stopping.filter((attempt) => attempt.stepId === pending.id);
  if (barrier.length > 0) return stepsOfAttempts(barrier, params.steps);

  const running = params.steps.filter(
    (step) => step.status === 'running' && step.type !== 'wait' && step.type !== 'composite',
  );
  const occupied = running.length + stopping.length;
  if (occupied < params.maxConcurrentSteps) return [];
  return [...running, ...stepsOfAttempts(stopping, params.steps)];
}
