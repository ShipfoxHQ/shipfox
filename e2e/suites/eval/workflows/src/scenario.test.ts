import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {runScenario, type ScenarioDriver, ScenarioError} from './scenario.js';
import type {ScenarioStep} from './schema.js';

const noRunPattern = /No run has started/u;
const failedPattern = /Step 2 \(await run succeeded\) failed: the run ended failed/u;
const noDeliveryPattern = /returned no delivery/u;

const pr = {number: 3, head: 'shipfox/task', base: 'main', sha: 'abc', repository: 'acme/app'};

function createDriver(overrides: Partial<ScenarioDriver> = {}): ScenarioDriver {
  return {
    references: {pr: () => pr},
    startManual: vi.fn(async () => 'run-1'),
    sendEvent: vi.fn(async () => ({})),
    runForDelivery: vi.fn(async () => 'run-2'),
    awaitStep: vi.fn(async () => undefined),
    ...overrides,
  };
}

const farDeadline = () => Date.now() + 60_000;

describe('runScenario', () => {
  it('runs the steps in order and resolves $pr in the events it sends', async () => {
    const driver = createDriver();
    const steps: ScenarioStep[] = [
      {start: {manual: {inputs: {title: 'Add a flag'}}}},
      {await: {job: 'implement', status: 'succeeded'}},
      {send: {github: {'pull_request.closed': {pull_request: '$pr', merged: true}}}},
      {await: {run: 'succeeded'}, timeout_seconds: 5},
    ];

    const result = await runScenario({steps, driver, deadline: farDeadline()});

    expect(result.runId).toBe('run-1');
    expect(result.records.map((record) => record.step)).toEqual([
      'start manual',
      'await job implement succeeded',
      'send github pull_request.closed',
      'await run succeeded',
    ]);
    expect(driver.startManual).toHaveBeenCalledWith({inputs: {title: 'Add a flag'}});
    expect(driver.sendEvent).toHaveBeenCalledWith({
      provider: 'github',
      event: 'pull_request.closed',
      payload: {pull_request: pr, merged: true},
      signal: expect.any(AbortSignal),
    });
    expect(driver.awaitStep).toHaveBeenLastCalledWith(
      expect.objectContaining({runId: 'run-1', timeoutMs: 5_000}),
    );
  });

  it('follows the delivery of an event that starts the run', async () => {
    const driver = createDriver({
      sendEvent: vi.fn(async () => ({deliveryId: 'delivery-1'})),
    });
    const steps: ScenarioStep[] = [
      {start: {event: {github: {'issues.labeled': {label: 'ready'}}}}},
    ];

    const result = await runScenario({steps, driver, deadline: farDeadline()});

    expect(result.runId).toBe('run-2');
    expect(driver.runForDelivery).toHaveBeenCalledWith(
      expect.objectContaining({deliveryId: 'delivery-1'}),
    );
  });

  it('fails an event start whose sender returns no delivery', async () => {
    const steps: ScenarioStep[] = [{start: {event: {github: {'issues.labeled': {}}}}}];

    await expect(
      runScenario({steps, driver: createDriver(), deadline: farDeadline()}),
    ).rejects.toThrow(noDeliveryPattern);
  });

  it('fails a step that needs a run before any start step', async () => {
    const steps: ScenarioStep[] = [{await: {run: 'succeeded'}}];

    await expect(
      runScenario({steps, driver: createDriver(), deadline: farDeadline()}),
    ).rejects.toThrow(noRunPattern);
  });

  it('reports the failed step and the steps before it', async () => {
    const driver = createDriver({
      awaitStep: vi.fn(() => Promise.reject(new Error('the run ended failed'))),
    });
    const steps: ScenarioStep[] = [{start: {manual: {inputs: {}}}}, {await: {run: 'succeeded'}}];

    const error = await runScenario({steps, driver, deadline: farDeadline()}).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ScenarioError);
    expect((error as ScenarioError).message).toMatch(failedPattern);
    expect((error as ScenarioError).records.map((record) => record.status)).toEqual([
      'passed',
      'failed',
    ]);
  });

  it('ends a send at the case abort signal', async () => {
    const driver = createDriver();
    const controller = new AbortController();
    const steps: ScenarioStep[] = [
      {start: {manual: {inputs: {}}}},
      {send: {github: {'pull_request.closed': {}}}, timeout_seconds: 30},
    ];

    await runScenario({steps, driver, deadline: farDeadline(), signal: controller.signal});
    const {signal} = (driver.sendEvent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      signal: AbortSignal;
    };
    controller.abort();

    expect(signal.aborted).toBe(true);
  });

  it('caps a step timeout at what is left of the case budget', async () => {
    const driver = createDriver();
    const steps: ScenarioStep[] = [
      {start: {manual: {inputs: {}}}},
      {await: {run: 'succeeded'}, timeout_seconds: 600},
    ];

    await runScenario({steps, driver, deadline: Date.now() + 2_000});

    const {timeoutMs} = (driver.awaitStep as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      timeoutMs: number;
    };
    expect(timeoutMs).toBeLessThanOrEqual(2_000);
  });
});
