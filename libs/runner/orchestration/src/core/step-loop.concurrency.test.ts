import type {StepDto} from '@shipfox/api-workflows-dto';
import {isStepCancelAbort} from '@shipfox/runner-execution/step-cancel';
import {HTTPError} from 'ky';
import type {StepLeases} from '#core/step-lease-tokens.js';

// A fake server drives the scheduler through `requestNextStep`, answering from what the runner
// says it holds, as the real one does. Steps run through a gate the test opens.

interface NextOptions {
  inFlight: readonly {stepId: string; attempt: number}[];
  signal?: AbortSignal;
}

const {nextServer, interruptibleSleepMock} = vi.hoisted(() => ({
  nextServer: {
    handler: undefined as undefined | ((options: NextOptions) => unknown),
    calls: [] as NextOptions['inFlight'][],
  },
  interruptibleSleepMock: vi.fn(),
}));

const reportStepMock = vi.fn();
const executeRunStepMock = vi.fn();
const executeSetupStepMock = vi.fn();
const reportOutOfMemoryKillsMock = vi.fn();
const recordJobStepsInFlightMock = vi.fn();
const createStepLogStreamMock = vi.fn();

vi.mock('#config.js', () => ({
  config: {SHIPFOX_POLL_INTERVAL_MS: 1000, SHIPFOX_POLL_MAX_INTERVAL_MS: 5000},
}));

vi.mock('@shipfox/node-resilient-loop', async (importActual) => ({
  ...(await importActual<typeof import('@shipfox/node-resilient-loop')>()),
  interruptibleSleep: interruptibleSleepMock,
}));

vi.mock('#metrics/index.js', () => ({
  recordJobStepsInFlight: (...args: unknown[]) => recordJobStepsInFlightMock(...args),
}));

vi.mock('@shipfox/runner-protocol', () => ({
  requestNextStep: (_client: unknown, options: NextOptions) => {
    const inFlight = options.inFlight ?? [];
    nextServer.calls.push(inFlight);
    try {
      return Promise.resolve(nextServer.handler?.({...options, inFlight}));
    } catch (error) {
      return Promise.reject(error);
    }
  },
  reportStep: (...args: unknown[]) => reportStepMock(...args),
  appendStepLogs: vi.fn(),
  writeStepAnnotations: vi.fn(async () => ({status: 'written'})),
  requestActionBundle: vi.fn(),
  requestStepSecrets: vi.fn(async () => ({secrets: []})),
  integrationToolsGatewayUrl: vi.fn(),
  createIntegrationToolsGatewayFetch: vi.fn(),
  createIntegrationToolsDownload: vi.fn(),
  HTTPError,
}));

vi.mock('@shipfox/runner-execution', () => ({
  executeRunStep: (...args: unknown[]) => executeRunStepMock(...args),
  executeSetupStep: (...args: unknown[]) => executeSetupStepMock(...args),
  actionsDirectory: (jobTempDir: string) => `${jobTempDir}/actions`,
  prepareStepActionBundle: vi.fn(async () => undefined),
  resolveCgroupMemoryEventsPath: () => Promise.resolve(undefined),
  reportOutOfMemoryKills: (options: unknown) => reportOutOfMemoryKillsMock(options),
}));

vi.mock('@shipfox/runner-container', () => ({ContainerExecutionHost: class {}}));

vi.mock('@shipfox/runner-logs', async () => {
  const actual =
    await vi.importActual<typeof import('@shipfox/runner-logs')>('@shipfox/runner-logs');
  return {
    createStepLogStream: (...args: unknown[]) => createStepLogStreamMock(...args),
    createSessionLogStream: vi.fn(),
    buildSecretVariants: actual.buildSecretVariants,
  };
});

vi.mock('@shipfox/runner-workspace', () => ({
  createJobLogsDir: vi.fn(),
  normalizeRepositoryUrl: (value: string) => value,
  resolveWorkingDirectory: async (cwd: string) => cwd,
}));

const {runJobSteps} = await import('#core/step-loop.js');

const JOB_ID = '00000000-0000-0000-0000-0000000000aa';
const UNKNOWN_STEP_ID = '00000000-0000-0000-0000-0000000000ff';
const JOB_CONTEXT = {
  workflowRunId: '00000000-0000-0000-0000-000000000004',
  workflowRunAttemptId: '00000000-0000-0000-0000-0000000000ab',
  jobId: JOB_ID,
  jobExecutionId: '00000000-0000-0000-0000-0000000000ad',
};
const leaseClient = {} as never;
const SUCCESS = {success: true, error: null, exit_code: 0};

const SETUP = buildStep({
  id: '00000000-0000-0000-0000-0000000000b0',
  name: 'Set up job',
  type: 'setup',
  config: {},
  position: 0,
});
const STEP_A = buildStep({id: '00000000-0000-0000-0000-0000000000a1', name: 'a', position: 1});
const STEP_B = buildStep({id: '00000000-0000-0000-0000-0000000000a2', name: 'b', position: 2});
const STEP_C = buildStep({id: '00000000-0000-0000-0000-0000000000a3', name: 'c', position: 3});

interface RunningStep {
  signal: AbortSignal;
  finish: (result: Record<string, unknown>) => void;
}

// What the test sees of the steps the runner executes.
let running: Map<string, RunningStep>;
let aborts: Array<{stepId: string; cancel: boolean}>;
let order: string[];

const stepLeases: StepLeases = {
  hold: ({leaseToken}) => ({
    client: leaseClient,
    token: () => leaseToken,
    release: () => undefined,
  }),
};

describe('runJobSteps with steps that run at the same time', () => {
  beforeEach(() => {
    running = new Map();
    aborts = [];
    order = [];
    nextServer.calls = [];
    nextServer.handler = undefined;
    interruptibleSleepMock.mockReset();
    interruptibleSleepMock.mockImplementation(sleepOneTick);
    recordJobStepsInFlightMock.mockReset();
    reportOutOfMemoryKillsMock.mockReset();
    reportOutOfMemoryKillsMock.mockImplementation(({run}: {run: () => unknown}) => run());
    reportStepMock.mockReset();
    reportStepMock.mockImplementation((_client: unknown, params: {stepId: string}) => {
      order.push(`report:${params.stepId}`);
      return Promise.resolve({ok: true, cancel: false});
    });
    executeSetupStepMock.mockReset();
    executeSetupStepMock.mockResolvedValue({result: SUCCESS});
    executeRunStepMock.mockReset();
    executeRunStepMock.mockImplementation(
      (step: StepDto, options: {signal: AbortSignal; carriedEnv?: unknown}) =>
        new Promise((resolve) => {
          const stepId = step.id;
          const onAbort = () => {
            aborts.push({stepId, cancel: isStepCancelAbort(options.signal)});
            // A process killed by a signal still leaves the files it wrote.
            resolve({
              success: false,
              error: {message: 'Killed by signal SIGTERM', exit_code: null, signal: 'SIGTERM'},
              exit_code: null,
              carriedEnv: {env: {FROM: stepId}, path: []},
            });
          };
          running.set(stepId, {
            signal: options.signal,
            finish: (result) => {
              options.signal.removeEventListener('abort', onAbort);
              resolve(result);
            },
          });
          options.signal.addEventListener('abort', onAbort, {once: true});
        }),
    );
    createStepLogStreamMock.mockReset();
    createStepLogStreamMock.mockImplementation((options: {stepId: string}) => {
      const stepId = options.stepId;
      const stream = fakeStream((event) => {
        order.push(`${event}:${stepId}`);
      });
      return stream;
    });
  });

  it('does not run a step twice when the server hands it over again', async () => {
    const handedOut = new Set<string>();
    let redeliveries = 0;
    serveAfterSetup(handedOut, ({holds}) => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A);
      if (holds(STEP_A)) {
        if (redeliveries >= 3) return wait();
        redeliveries += 1;
        return stepResponse(STEP_A);
      }
      return done();
    });
    const loop = runLoop();

    await vi.waitFor(() => expect(redeliveries).toBe(3));
    finishStep(STEP_A);
    await loop;

    expect(executeRunStepMock).toHaveBeenCalledTimes(1);
    expect(reportedStatuses(STEP_A)).toEqual(['succeeded']);
  });

  it('keeps a step in flight until its report returns', async () => {
    const reportReturn = holdReportOf(STEP_A);
    const handedOut = new Set<string>();
    serveAfterSetup(handedOut, ({inFlight}) => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A);
      return inFlight.length > 0 ? stepResponse(STEP_A) : done();
    });
    const loop = runLoop();
    await vi.waitFor(() => expect(running.has(STEP_A.id)).toBe(true));

    finishStep(STEP_A);
    await vi.waitFor(() => expect(order).toContain(`report:${STEP_A.id}`));
    const callsBeforeReportReturned = nextServer.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stillHeld = nextServer.calls.slice(callsBeforeReportReturned - 1);
    reportReturn.resolve({ok: true, cancel: false});
    await loop;

    expect(stillHeld.every((held) => held.some(({stepId}) => stepId === STEP_A.id))).toBe(true);
    expect(executeRunStepMock).toHaveBeenCalledTimes(1);
  });

  it('wakes its sleep when a step ends, after the report, instead of waiting out the delay', async () => {
    interruptibleSleepMock.mockImplementation(sleepUntilAborted);
    const handedOut = new Set<string>();
    serveAfterSetup(handedOut, ({inFlight}) => {
      order.push(`next:${inFlight.length}`);
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A);
      return inFlight.length > 0 ? wait(60_000) : done();
    });
    const loop = runLoop();
    await vi.waitFor(() => expect(running.has(STEP_A.id)).toBe(true));
    await vi.waitFor(() =>
      expect(interruptibleSleepMock.mock.calls.filter(([delay]) => delay === 60_000)).not.toEqual(
        [],
      ),
    );

    finishStep(STEP_A);
    await loop;

    expect(order.indexOf(`report:${STEP_A.id}`)).toBeGreaterThan(-1);
    const lastNext = order.lastIndexOf('next:0');
    expect(lastNext).toBeGreaterThan(order.indexOf(`report:${STEP_A.id}`));
  });

  it('runs two background steps at once and reports both', async () => {
    const handedOut = new Set<string>();
    serveAfterSetup(handedOut, ({inFlight}) => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
      if (!handedOut.has(STEP_B.id)) return handOut(handedOut, STEP_B, {background: true});
      return inFlight.length > 0 ? wait() : done();
    });
    const loop = runLoop();

    await vi.waitFor(() => expect(running.size).toBe(2));
    finishStep(STEP_B);
    await vi.waitFor(() => expect(order).toContain(`report:${STEP_B.id}`));
    finishStep(STEP_A);
    await loop;

    expect(
      nextServer.calls.some(
        (held) =>
          held.length === 2 &&
          held.some(({stepId}) => stepId === STEP_A.id) &&
          held.some(({stepId}) => stepId === STEP_B.id),
      ),
    ).toBe(true);
    expect(reportedStatuses(STEP_A)).toEqual(['succeeded']);
    expect(reportedStatuses(STEP_B)).toEqual(['succeeded']);
    expect(recordJobStepsInFlightMock.mock.calls.map(([count]) => count)).toEqual([
      1, 0, 1, 2, 1, 0,
    ]);
  });

  it('tells the out-of-memory report how many steps ran alongside', async () => {
    const handedOut = new Set<string>();
    serveAfterSetup(handedOut, ({inFlight}) => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
      if (!handedOut.has(STEP_B.id)) return handOut(handedOut, STEP_B, {background: true});
      return inFlight.length > 0 ? wait() : done();
    });
    const loop = runLoop();
    await vi.waitFor(() => expect(running.size).toBe(2));

    finishStep(STEP_B);
    finishStep(STEP_A);
    await loop;

    const overlaps = reportOutOfMemoryKillsMock.mock.calls.map(([options]) =>
      (options as {overlappingSteps: () => number}).overlappingSteps(),
    );
    expect(overlaps).toEqual([2, 2]);
  });

  describe('when the server asks to stop a step', () => {
    it('terminates only that step with the cancel mode, reads its files, and reports cancelled', async () => {
      let cancelRequested = false;
      serveStepAThenStepC(() => cancelRequested);
      const loop = runLoop();
      await vi.waitFor(() => expect(running.has(STEP_A.id)).toBe(true));

      cancelRequested = true;
      await vi.waitFor(() => expect(running.has(STEP_C.id)).toBe(true));
      finishStep(STEP_C);
      await loop;

      expect(aborts).toEqual([{stepId: STEP_A.id, cancel: true}]);
      expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
        stepId: STEP_A.id,
        attempt: 1,
        status: 'cancelled',
        exitCode: null,
        logOutcome: 'drained',
        signal: expect.any(AbortSignal),
      });
      expect(order.indexOf(`drain:${STEP_A.id}`)).toBeLessThan(
        order.indexOf(`report:${STEP_A.id}`),
      );
      expect(
        (executeRunStepMock.mock.calls.at(-1)?.[1] as {carriedEnv?: unknown}).carriedEnv,
      ).toEqual({env: {FROM: STEP_A.id}, path: []});
    });

    it('ignores a cancel that arrives again after a lost response, and one for an unknown step', async () => {
      const reportReturn = holdReportOf(STEP_A);
      let cancelRequested = false;
      let lostResponses = 0;
      const cancelAnswers: number[] = [];
      serveStepAInBackground(() => {
        if (!cancelRequested) return wait();
        if (lostResponses === 0) {
          lostResponses += 1;
          throw buildHTTPError(503);
        }
        cancelAnswers.push(cancelAnswers.length);
        return wait(1000, [STEP_A.id, UNKNOWN_STEP_ID]);
      });
      const loop = runLoop();
      await vi.waitFor(() => expect(running.has(STEP_A.id)).toBe(true));

      cancelRequested = true;
      await vi.waitFor(() => expect(cancelAnswers.length).toBeGreaterThanOrEqual(3));
      reportReturn.resolve({ok: true, cancel: false});
      await loop;

      expect(aborts).toEqual([{stepId: STEP_A.id, cancel: true}]);
      expect(reportedStatuses(STEP_A)).toEqual(['cancelled']);
    });

    it('ignores a cancel for a step that is not running', async () => {
      const handedOut = new Set<string>();
      serveAfterSetup(handedOut, ({holds}) => {
        if (!handedOut.has(STEP_A.id)) {
          handedOut.add(STEP_A.id);
          return {...stepResponse(STEP_A), cancel_step_ids: [UNKNOWN_STEP_ID]};
        }
        return holds(STEP_A) ? wait(1000, [UNKNOWN_STEP_ID]) : done();
      });
      const loop = runLoop();
      await vi.waitFor(() => expect(running.has(STEP_A.id)).toBe(true));

      finishStep(STEP_A);
      await loop;

      expect(aborts).toEqual([]);
      expect(reportedStatuses(STEP_A)).toEqual(['succeeded']);
    });
  });

  it('stops every step without a report when the job is aborted', async () => {
    const handedOut = new Set<string>();
    serveAfterSetup(handedOut, () => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
      return wait();
    });
    const ac = new AbortController();
    const loop = runLoop({signal: ac.signal});
    await vi.waitFor(() => expect(running.has(STEP_A.id)).toBe(true));

    ac.abort();
    await loop;

    expect(aborts).toEqual([{stepId: STEP_A.id, cancel: false}]);
    expect(reportedStatuses(STEP_A)).toEqual([]);
    expect(reportedStatuses(SETUP)).toEqual(['succeeded']);
  });

  it('waits for the steps in flight when the server says the job is done', async () => {
    const handedOut = new Set<string>();
    let doneAnswered = false;
    serveAfterSetup(handedOut, () => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
      doneAnswered = true;
      return done();
    });
    const settled = vi.fn();
    const loop = runLoop().then(settled);
    await vi.waitFor(() => expect(doneAnswered).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(settled).not.toHaveBeenCalled();
    finishStep(STEP_A);
    await loop;

    expect(reportedStatuses(STEP_A)).toEqual(['succeeded']);
  });

  it('stops the other steps without a report when a report says the job is over', async () => {
    reportStepMock.mockImplementation((_client: unknown, params: {stepId: string}) => {
      order.push(`report:${params.stepId}`);
      return Promise.resolve({ok: true, cancel: params.stepId === STEP_B.id});
    });
    const handedOut = new Set<string>();
    serveAfterSetup(handedOut, () => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
      if (!handedOut.has(STEP_B.id)) return handOut(handedOut, STEP_B, {background: true});
      return wait();
    });
    const loop = runLoop();
    await vi.waitFor(() => expect(running.size).toBe(2));

    finishStep(STEP_B, {success: false, error: {message: 'boom'}, exit_code: 1});
    await loop;

    expect(aborts).toEqual([{stepId: STEP_A.id, cancel: false}]);
    expect(reportedStatuses(STEP_A)).toEqual([]);
    expect(reportedStatuses(STEP_B)).toEqual(['failed']);
  });

  it('stops the job and rethrows when a report fails for good', async () => {
    const failure = new Error('report rejected');
    reportStepMock.mockImplementation((_client: unknown, params: {stepId: string}) =>
      params.stepId === STEP_B.id
        ? Promise.reject(failure)
        : Promise.resolve({ok: true, cancel: false}),
    );
    const handedOut = new Set<string>();
    serveAfterSetup(handedOut, () => {
      if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
      if (!handedOut.has(STEP_B.id)) return handOut(handedOut, STEP_B, {background: true});
      return wait();
    });
    const loop = runLoop();
    const rejection = expect(loop).rejects.toBe(failure);
    await vi.waitFor(() => expect(running.size).toBe(2));

    finishStep(STEP_B);
    await rejection;

    expect(aborts).toEqual([{stepId: STEP_A.id, cancel: false}]);
  });
});

// Hands out the setup step and waits for it, then leaves the rest of the job to `serve`.
function serveAfterSetup(
  handedOut: Set<string>,
  serve: (context: {
    inFlight: NextOptions['inFlight'];
    holds: (step: StepDto) => boolean;
  }) => unknown,
): void {
  nextServer.handler = ({inFlight}) => {
    const holds = (step: StepDto) => inFlight.some((held) => held.stepId === step.id);
    if (!handedOut.has(SETUP.id)) return handOut(handedOut, SETUP);
    if (holds(SETUP)) return wait();
    return serve({inFlight, holds});
  };
}

function runLoop(params: {signal?: AbortSignal} = {}): Promise<void> {
  return runJobSteps({
    jobId: JOB_ID,
    leaseClient,
    stepLeases,
    secrets: [],
    signal: params.signal ?? new AbortController().signal,
    cwd: '/work',
    gitConfigPath: '/runner-cred/job-1/git-cred.config',
    logsDir: '/runner-logs/job-1',
    agentStateDir: '/runner-agent/job-1',
    tempDir: '/runner-tmp/job-1',
    credentialsDir: '/runner-cred/job-1',
    jobContext: JOB_CONTEXT,
  });
}

function finishStep(step: StepDto, result: Record<string, unknown> = SUCCESS): void {
  const held = running.get(step.id);
  if (!held) throw new Error(`Step ${step.id} is not running`);
  held.finish(result);
}

function reportedStatuses(step: StepDto): string[] {
  return reportStepMock.mock.calls
    .map(([, params]) => params as {stepId: string; status: string})
    .filter((params) => params.stepId === step.id)
    .map((params) => params.status);
}

function handOut(
  handedOut: Set<string>,
  step: StepDto,
  extra: {background?: boolean; envFrom?: StepDto} = {},
) {
  handedOut.add(step.id);
  const {envFrom, ...response} = extra;
  return {
    ...stepResponse(step),
    ...response,
    ...(envFrom ? {env_sources: [{position: envFrom.position, attempt: 1}]} : {}),
  };
}

// Hands out step A in the background after setup, and answers `onHeld` while the runner holds it.
function serveStepAInBackground(onHeld: () => unknown): void {
  const handedOut = new Set<string>();
  serveAfterSetup(handedOut, ({holds}) => {
    if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
    return holds(STEP_A) ? onHeld() : done();
  });
}

// Hands out step A in the background, asks to cancel it once told to, then hands out step C,
// which carries the env of step A.
function serveStepAThenStepC(cancelRequested: () => boolean): void {
  const handedOut = new Set<string>();
  serveAfterSetup(handedOut, ({inFlight, holds}) => {
    if (!handedOut.has(STEP_A.id)) return handOut(handedOut, STEP_A, {background: true});
    if (holds(STEP_A)) return wait(1000, cancelRequested() ? [STEP_A.id] : []);
    if (!handedOut.has(STEP_C.id)) return handOut(handedOut, STEP_C, {envFrom: STEP_A});
    return inFlight.length > 0 ? wait() : done();
  });
}

// Keeps the report of `step` from returning until the test says so.
function holdReportOf(step: StepDto) {
  const returned = deferred<{ok: boolean; cancel: boolean}>();
  reportStepMock.mockImplementation((_client: unknown, params: {stepId: string}) => {
    order.push(`report:${params.stepId}`);
    return params.stepId === step.id
      ? returned.promise
      : Promise.resolve({ok: true, cancel: false});
  });
  return returned;
}

function stepResponse(step: StepDto) {
  return {
    kind: 'step',
    step,
    attempt: 1,
    lease_token: `lease-${step.id}`,
    background: false,
    cancel_step_ids: [],
  };
}

function wait(retryAfterMs = 1000, cancelStepIds: string[] = []) {
  return {kind: 'wait', retry_after_ms: retryAfterMs, cancel_step_ids: cancelStepIds};
}

function done() {
  return {kind: 'done', status: 'succeeded', cancel_step_ids: []};
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {promise, resolve};
}

// Sleeps one tick unless the signal aborts first, so a loop that polls does not starve timers.
function sleepOneTick(_ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, 1);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      {once: true},
    );
  });
}

// Only an abort ends the sleep, so a loop that is not woken hangs the test.
function sleepUntilAborted(_ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener('abort', () => resolve(), {once: true});
  });
}

function fakeStream(record: (event: string) => void) {
  return {
    write: vi.fn(),
    addSecrets: vi.fn(),
    setRotatingSecrets: vi.fn(),
    writeGroupStart: vi.fn(),
    writeGroupEnd: vi.fn(),
    writeGroup: vi.fn(),
    writeOutputLine: vi.fn(),
    writeEntry: vi.fn(),
    writeToolRow: vi.fn(),
    close: vi.fn(() => Promise.resolve({streamLength: 0})),
    drain: vi.fn(() => {
      record('drain');
      return Promise.resolve('drained');
    }),
    dispose: vi.fn(),
    finalizeTextLog: vi.fn((): string | undefined => undefined),
  };
}

function buildHTTPError(status: number): HTTPError {
  const response = {status} as Response;
  const request = {} as Request;
  const options = {} as ConstructorParameters<typeof HTTPError>[2];
  return new HTTPError(response, request, options);
}

function buildStep(overrides: Partial<StepDto>): StepDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    key: 'test-step',
    name: 'test-step',
    source_location: null,
    status: 'running',
    status_reason: null,
    type: 'run',
    config: {run: 'echo test'},
    error: null,
    evaluation_trace: null,
    session: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
