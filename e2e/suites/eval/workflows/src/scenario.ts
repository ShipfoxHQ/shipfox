import {describeAwait} from './awaits.js';
import {type PullRequestReference, resolveReferences} from './references.js';
import type {ScenarioStep} from './schema.js';

const DEFAULT_START_TIMEOUT_SECONDS = 60;
const DEFAULT_AWAIT_TIMEOUT_SECONDS = 180;
const NO_RUN = 'No run has started. Put a start step first.';

export interface ScenarioStepRecord {
  index: number;
  step: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  error?: string;
}

/** What a scenario needs from the arranged stack. Tests replace it with a fake. */
export interface ScenarioDriver {
  references: {pr: () => PullRequestReference};
  startManual(params: {inputs: Record<string, unknown>}): Promise<string>;
  sendEvent(params: {
    provider: string;
    event: string;
    payload: Record<string, unknown>;
  }): Promise<{deliveryId?: string | undefined}>;
  runForDelivery(params: {
    deliveryId: string;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  }): Promise<string>;
  awaitStep(params: {
    step: Extract<ScenarioStep, {await: unknown}>['await'];
    runId: string;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  }): Promise<void>;
}

export class ScenarioError extends Error {
  readonly records: ScenarioStepRecord[];

  constructor(message: string, records: ScenarioStepRecord[]) {
    super(message);
    this.name = 'ScenarioError';
    this.records = records;
  }
}

function singleEvent(event: Record<string, Record<string, unknown>>) {
  const [provider, events] = Object.entries(event)[0] ?? [];
  const [name, payload] = Object.entries(events ?? {})[0] ?? [];
  if (provider === undefined || name === undefined) throw new Error('The event is empty.');
  return {provider, event: name, payload: payload as Record<string, unknown>};
}

function describeStep(step: ScenarioStep): string {
  if ('await' in step) return `await ${describeAwait(step.await)}`;
  if ('send' in step) {
    const {provider, event} = singleEvent(step.send);
    return `send ${provider} ${event}`;
  }
  if ('manual' in step.start) return 'start manual';
  const {provider, event} = singleEvent(step.start.event);
  return `start ${provider} ${event}`;
}

interface StepContext {
  driver: ScenarioDriver;
  deadline: number;
  signal?: AbortSignal | undefined;
}

function budget({
  seconds,
  fallback,
  deadline,
}: {
  seconds: number | undefined;
  fallback: number;
  deadline: number;
}): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('The case timeout ran out.');
  return Math.min((seconds ?? fallback) * 1_000, remaining);
}

function eventOf(event: Record<string, Record<string, unknown>>, driver: ScenarioDriver) {
  const {payload, ...rest} = singleEvent(event);
  return {
    ...rest,
    payload: resolveReferences(payload, driver.references) as Record<string, unknown>,
  };
}

/** Runs one step. It returns the run id, which a start step sets. */
async function runStep({
  step,
  runId,
  context,
}: {
  step: ScenarioStep;
  runId: string | undefined;
  context: StepContext;
}): Promise<string | undefined> {
  const {driver, deadline, signal} = context;
  if ('await' in step) {
    if (runId === undefined) throw new Error(NO_RUN);
    await driver.awaitStep({
      step: step.await,
      runId,
      timeoutMs: budget({
        seconds: step.timeout_seconds,
        fallback: DEFAULT_AWAIT_TIMEOUT_SECONDS,
        deadline,
      }),
      signal,
    });
    return runId;
  }
  if ('send' in step) {
    if (runId === undefined) throw new Error(NO_RUN);
    await driver.sendEvent(eventOf(step.send, driver));
    return runId;
  }
  if (runId !== undefined) throw new Error('A run has already started.');
  if ('manual' in step.start) {
    const inputs = resolveReferences(step.start.manual.inputs, driver.references);
    return await driver.startManual({inputs: inputs as Record<string, unknown>});
  }
  const timeoutMs = budget({
    seconds: step.timeout_seconds,
    fallback: DEFAULT_START_TIMEOUT_SECONDS,
    deadline,
  });
  const event = eventOf(step.start.event, driver);
  const {deliveryId} = await driver.sendEvent(event);
  if (deliveryId === undefined) {
    throw new Error(`The ${event.provider} sender returned no delivery to follow.`);
  }
  return await driver.runForDelivery({deliveryId, timeoutMs, signal});
}

/**
 * Runs the steps in order. Each step is bounded by its own timeout and by what is left of the
 * case's budget. `deadline` is an epoch in milliseconds.
 */
export async function runScenario({
  steps,
  driver,
  deadline,
  signal,
}: {
  steps: readonly ScenarioStep[];
  driver: ScenarioDriver;
  deadline: number;
  signal?: AbortSignal | undefined;
}): Promise<{runId: string; records: ScenarioStepRecord[]}> {
  const records: ScenarioStepRecord[] = [];
  let runId: string | undefined;

  for (const [index, step] of steps.entries()) {
    const description = describeStep(step);
    const startedAt = Date.now();
    const record = {index: index + 1, step: description};
    try {
      runId = await runStep({step, runId, context: {driver, deadline, signal}});
      records.push({...record, status: 'passed', duration_ms: Date.now() - startedAt});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      records.push({
        ...record,
        status: 'failed',
        duration_ms: Date.now() - startedAt,
        error: message,
      });
      throw new ScenarioError(`Step ${index + 1} (${description}) failed: ${message}`, records);
    }
  }

  if (runId === undefined) throw new Error(NO_RUN);
  return {runId, records};
}
