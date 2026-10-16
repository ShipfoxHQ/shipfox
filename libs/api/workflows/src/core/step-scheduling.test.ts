import type {Step, StepAttempt} from './entities/step.js';
import {
  dispatchBlockers,
  holdsAttempt,
  isHeldByRunner,
  nextScanAction,
  retryAfterMs,
  withInnerSteps,
} from './step-scheduling.js';

function step(overrides: Partial<Step> & Pick<Step, 'id' | 'position'>): Step {
  return {
    type: 'run',
    status: 'pending',
    background: false,
    currentAttempt: 1,
    parentStepId: null,
    config: {},
    ...overrides,
  } as Step;
}

function attempt(overrides: Partial<StepAttempt> & Pick<StepAttempt, 'stepId'>): StepAttempt {
  return {attempt: 1, status: 'running', cancelRequestedAt: null, ...overrides} as StepAttempt;
}

describe('nextScanAction', () => {
  test('is idle when every step is terminal', () => {
    const steps = [step({id: 'a', position: 0, status: 'succeeded'})];

    expect(nextScanAction(steps)).toEqual({kind: 'idle'});
  });

  test('is blocked, not idle, while only a background step runs', () => {
    const background = step({id: 'a', position: 0, status: 'running', background: true});

    expect(nextScanAction([background])).toEqual({kind: 'blocked', blockers: [background]});
  });

  test('lets a pending step start beside a running background step', () => {
    const pending = step({id: 'b', position: 1});
    const steps = [step({id: 'a', position: 0, status: 'running', background: true}), pending];

    expect(nextScanAction(steps)).toEqual({kind: 'pending', step: pending});
  });

  test('blocks behind a running foreground step', () => {
    const running = step({id: 'a', position: 0, status: 'running'});

    expect(nextScanAction([running, step({id: 'b', position: 1})])).toEqual({
      kind: 'blocked',
      blockers: [running],
    });
  });
});

describe('holdsAttempt', () => {
  test('matches the step and the attempt', () => {
    const inFlight = [{stepId: 'a', attempt: 2}];

    expect(holdsAttempt(inFlight, {stepId: 'a', attempt: 2})).toBe(true);
    expect(holdsAttempt(inFlight, {stepId: 'a', attempt: 1})).toBe(false);
    expect(isHeldByRunner(inFlight, {id: 'a', currentAttempt: 2})).toBe(true);
  });
});

describe('withInnerSteps', () => {
  test('adds the steps inside a composite, at any depth', () => {
    const composite = step({id: 'c', position: 1, type: 'composite'});
    const inner = step({id: 'i', position: 2, parentStepId: 'c', type: 'composite'});
    const deeper = step({id: 'd', position: 3, parentStepId: 'i'});
    const other = step({id: 'o', position: 4});

    const result = withInnerSteps([composite], [composite, inner, deeper, other]);

    expect(result.map((entry) => entry.id)).toEqual(['c', 'i', 'd']);
  });
});

describe('dispatchBlockers', () => {
  test('makes a checkout wait for any stopping attempt', () => {
    const stopped = step({id: 'a', position: 1, status: 'cancelled'});
    const checkout = step({id: 'c', position: 2, type: 'checkout'});

    const blockers = dispatchBlockers({
      pending: checkout,
      steps: [stopped, checkout],
      attempts: [attempt({stepId: 'a', cancelRequestedAt: new Date()})],
      maxConcurrentSteps: 20,
    });

    expect(blockers).toEqual([stopped]);
  });

  test('counts stopping attempts against the limit', () => {
    const stopped = step({id: 'a', position: 1, status: 'cancelled'});
    const pending = step({id: 'b', position: 2});

    const blockers = dispatchBlockers({
      pending,
      steps: [stopped, pending],
      attempts: [attempt({stepId: 'a', cancelRequestedAt: new Date()})],
      maxConcurrentSteps: 1,
    });

    expect(blockers).toEqual([stopped]);
  });
});

describe('retryAfterMs', () => {
  test('polls fast for a server-run blocker and slowly for runner steps', () => {
    expect(retryAfterMs([{type: 'tool'}])).toBe(1000);
    expect(retryAfterMs([{type: 'run'}])).toBe(30_000);
  });
});
