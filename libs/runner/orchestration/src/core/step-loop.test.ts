import type {AgentConfigIssue, NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';
import {HTTPError} from 'ky';

const {AgentRuntimeConfigRequestError} = vi.hoisted(() => ({
  AgentRuntimeConfigRequestError: class AgentRuntimeConfigRequestError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string | undefined,
      public readonly agentConfigIssue: AgentConfigIssue | undefined = undefined,
    ) {
      super(
        code === undefined
          ? `Agent runtime config request failed with status ${status}.`
          : `Agent runtime config request failed with status ${status}: ${code}.`,
      );
      this.name = 'AgentRuntimeConfigRequestError';
    }
  },
}));

const requestNextStepMock = vi.fn();
const requestAgentRuntimeConfigMock = vi.fn();
const reportStepMock = vi.fn();
const appendStepLogsMock = vi.fn();
const executeRunStepMock = vi.fn();
const executeSetupStepMock = vi.fn();
const createStepLogStreamMock = vi.fn();
const createSessionLogStreamMock = vi.fn();
const executeAgentStepMock = vi.fn();

vi.mock('@shipfox/runner-protocol', () => ({
  requestNextStep: (...args: unknown[]) => requestNextStepMock(...args),
  requestAgentRuntimeConfig: (...args: unknown[]) => requestAgentRuntimeConfigMock(...args),
  reportStep: (...args: unknown[]) => reportStepMock(...args),
  appendStepLogs: (...args: unknown[]) => appendStepLogsMock(...args),
  AgentRuntimeConfigRequestError,
  HTTPError,
}));

vi.mock('@shipfox/runner-execution', () => ({
  executeRunStep: (...args: unknown[]) => executeRunStepMock(...args),
  executeSetupStep: (...args: unknown[]) => executeSetupStepMock(...args),
}));

vi.mock('@shipfox/runner-logs', async () => {
  const actual =
    await vi.importActual<typeof import('@shipfox/runner-logs')>('@shipfox/runner-logs');
  return {
    createStepLogStream: (...args: unknown[]) => createStepLogStreamMock(...args),
    createSessionLogStream: (...args: unknown[]) => createSessionLogStreamMock(...args),
    buildSecretVariants: actual.buildSecretVariants,
  };
});

vi.mock('@shipfox/runner-agent', () => ({
  executeAgentStep: (...args: unknown[]) => executeAgentStepMock(...args),
}));

const {executeStep, runJobSteps} = await import('#core/step-loop.js');

const JOB_ID = '00000000-0000-0000-0000-0000000000aa';
const RUN_ID = '00000000-0000-0000-0000-0000000000ab';
const LOGS_DIR = '/runner-logs/job-1';
const JOB_CONTEXT = {jobId: JOB_ID, runId: RUN_ID};
const leaseClient = {} as never;
const STREAM_LENGTH = 128;

// Ordered log of stream lifecycle events across all created streams, so tests can
// assert "prior attempt drained before the next opens".
let events: string[];
let createdStreams: Map<string, FakeStream[]>;

interface FakeStream {
  write: ReturnType<typeof vi.fn>;
  addSecrets: ReturnType<typeof vi.fn>;
  setRotatingSecrets: ReturnType<typeof vi.fn>;
  writeGroupStart: ReturnType<typeof vi.fn>;
  writeGroupEnd: ReturnType<typeof vi.fn>;
  writeGroup: ReturnType<typeof vi.fn>;
  writeOutputLine: ReturnType<typeof vi.fn>;
  writeEntry: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  drain: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function makeFakeStream(
  label: string,
  drainOutcome: 'drained' | 'abandoned' = 'drained',
): FakeStream {
  const stream = {
    write: vi.fn(() => {
      events.push(`write:${label}`);
    }),
    addSecrets: vi.fn(() => {
      events.push(`secrets:${label}`);
    }),
    setRotatingSecrets: vi.fn(() => {
      events.push(`rotatingSecrets:${label}`);
    }),
    writeGroupStart: vi.fn(() => {
      events.push(`groupStart:${label}`);
    }),
    writeGroupEnd: vi.fn(() => {
      events.push(`groupEnd:${label}`);
    }),
    writeGroup: vi.fn(() => {
      events.push(`group:${label}`);
    }),
    writeOutputLine: vi.fn(() => {
      events.push(`line:${label}`);
    }),
    writeEntry: vi.fn(),
    close: vi.fn(() => {
      events.push(`close:${label}`);
      return Promise.resolve({streamLength: STREAM_LENGTH});
    }),
    drain: vi.fn(() => {
      events.push(`drain:${label}`);
      return Promise.resolve(drainOutcome);
    }),
    dispose: vi.fn(() => {
      events.push(`dispose:${label}`);
    }),
  };
  const prior = createdStreams.get(label) ?? [];
  prior.push(stream);
  createdStreams.set(label, prior);
  return stream;
}

function streamFor(stepId: string): FakeStream {
  const stream = createdStreams.get(stepId)?.at(-1);
  if (!stream) throw new Error(`No stream created for ${stepId}`);
  return stream;
}

function runLoop(params: {
  signal: AbortSignal;
  secrets?: string[];
  cwd?: string;
  subscribeSecrets?: (subscriber: (secrets: string[]) => void) => () => void;
}): Promise<void> {
  return runJobSteps({
    jobId: JOB_ID,
    leaseClient,
    secrets: params.secrets ?? [],
    ...(params.subscribeSecrets ? {subscribeSecrets: params.subscribeSecrets} : {}),
    signal: params.signal,
    cwd: params.cwd ?? '/work',
    logsDir: LOGS_DIR,
    jobContext: JOB_CONTEXT,
  });
}

describe('runJobSteps', () => {
  beforeEach(() => {
    requestNextStepMock.mockReset();
    requestAgentRuntimeConfigMock.mockReset();
    reportStepMock.mockReset();
    appendStepLogsMock.mockReset();
    executeRunStepMock.mockReset();
    executeSetupStepMock.mockReset();
    createStepLogStreamMock.mockReset();
    createSessionLogStreamMock.mockReset();
    executeAgentStepMock.mockReset();
    requestAgentRuntimeConfigMock.mockResolvedValue({
      provider_id: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      credentials: {api_key: 'sk-runtime-secret'},
    });
    events = [];
    createdStreams = new Map();
    reportStepMock.mockResolvedValue({ok: true, cancel: false});
    // Setup succeeds by default; tests that exercise setup failure override it.
    executeSetupStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    createStepLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      events.push(`create:${opts.stepId}`);
      return makeFakeStream(opts.stepId);
    });
    createSessionLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      events.push(`create:${opts.stepId}`);
      return makeFakeStream(opts.stepId);
    });
  });

  it('runs the setup step then a run step against the prepared cwd, reporting both', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).toHaveBeenCalledWith({
      cwd: '/work',
      leaseClient,
      signal: ac.signal,
      log: expect.any(Object),
      jobContext: JOB_CONTEXT,
    });
    expect(executeRunStepMock).toHaveBeenCalledWith(run, {
      signal: ac.signal,
      cwd: '/work',
      onCommandStart: expect.any(Function),
      onOutput: expect.any(Function),
    });
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(3);
  });

  it('opens a per-attempt log stream for the run step and disposes it at the end', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 3))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(createStepLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: run.id,
      attempt: 3,
      secrets: [],
      append: expect.any(Function),
    });
    expect(createStepLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: setup.id,
      attempt: 1,
      secrets: [],
      append: expect.any(Function),
    });
    expect(createStepLogStreamMock).toHaveBeenCalledTimes(2);
    expect(events).toContain(`drain:${run.id}`);
    expect(events).toContain(`dispose:${run.id}`);
  });

  it('adds renewed lease tokens to the active step log stream', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    let publishSecrets: ((secrets: string[]) => void) | undefined;
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockImplementation(() => {
      publishSecrets?.(['lease-token-next']);
      return Promise.resolve({success: true, error: null, exit_code: 0});
    });
    const ac = new AbortController();

    await runLoop({
      signal: ac.signal,
      subscribeSecrets: (subscriber) => {
        publishSecrets = subscriber;
        return () => {
          if (publishSecrets === subscriber) publishSecrets = undefined;
        };
      },
    });

    expect(streamFor(run.id).setRotatingSecrets).toHaveBeenCalledWith(['lease-token-next']);
    expect(publishSecrets).toBeUndefined();
  });

  it('routes captured output through the stream write sink', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    let captured: FakeStream | undefined;
    createStepLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      captured = makeFakeStream(opts.stepId);
      return captured;
    });
    executeRunStepMock.mockImplementation(
      (_step, opts: {onOutput: (chunk: Buffer, src: string) => void}) => {
        opts.onOutput(Buffer.from('hello'), 'stdout');
        return Promise.resolve({success: true, error: null, exit_code: 0});
      },
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(captured?.write).toHaveBeenCalledWith(Buffer.from('hello'), 'stdout');
  });

  it('writes command metadata before captured output', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({config: {run: 'echo hello'}});
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    let captured: FakeStream | undefined;
    createStepLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      captured = makeFakeStream(opts.stepId);
      return captured;
    });
    executeRunStepMock.mockImplementation(
      (
        _step,
        opts: {
          onCommandStart: (metadata: {
            command: string;
            shell: {display: string};
            cwd?: string;
          }) => void;
          onOutput: (chunk: Buffer, src: string) => void;
        },
      ) => {
        opts.onCommandStart({
          command: 'echo hello',
          shell: {display: 'bash --noprofile --norc -eo pipefail {0}'},
          cwd: '/work',
        });
        opts.onOutput(Buffer.from('hello'), 'stdout');
        return Promise.resolve({success: true, error: null, exit_code: 0});
      },
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(captured?.writeGroup).toHaveBeenCalledWith({
      name: 'Run echo hello',
      lines: [
        'echo hello',
        'shell: bash --noprofile --norc -eo pipefail {0}',
        'working-directory: /work',
      ],
      source: 'stdout',
    });
    expect(events.indexOf(`group:${run.id}`)).toBeLessThan(events.indexOf(`write:${run.id}`));
  });

  it('runs and reports the step when opening the log stream fails (capture abandoned)', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    // Opening the run spool throws (e.g. a broken logs dir): capture must be abandoned, not fatal.
    createStepLogStreamMock
      .mockImplementationOnce((opts: {stepId: string}) => {
        events.push(`create:${opts.stepId}`);
        return makeFakeStream(opts.stepId);
      })
      .mockImplementationOnce(() => {
        throw new Error('logs dir is a file');
      });
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeRunStepMock).toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: run.id, status: 'succeeded', logOutcome: 'abandoned'}),
    );
  });

  it('drains the stream before reporting and propagates an abandoned drain outcome', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    createStepLogStreamMock
      .mockImplementationOnce((opts: {stepId: string}) => {
        events.push(`create:${opts.stepId}`);
        return makeFakeStream(opts.stepId);
      })
      .mockImplementationOnce((opts: {stepId: string}) => {
        events.push(`create:${opts.stepId}`);
        return makeFakeStream(opts.stepId, 'abandoned');
      });
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    reportStepMock.mockImplementation((_client, params: {stepId: string; logOutcome: string}) => {
      events.push(`report:${params.stepId}:${params.logOutcome}`);
      return Promise.resolve({ok: true, cancel: false});
    });
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(events.indexOf(`drain:${run.id}`)).toBeLessThan(
      events.indexOf(`report:${run.id}:abandoned`),
    );
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: run.id, status: 'succeeded', logOutcome: 'abandoned'}),
    );
  });

  it('drains and disposes the prior attempt stream before opening the next', async () => {
    const setup = buildSetupStep();
    const run1 = buildRunStep({id: '00000000-0000-0000-0000-0000000000c1', position: 1});
    const run2 = buildRunStep({id: '00000000-0000-0000-0000-0000000000c2', position: 2});
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run1, 1))
      .mockResolvedValueOnce(stepResponse(run2, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(events.indexOf(`dispose:${run1.id}`)).toBeLessThan(events.indexOf(`create:${run2.id}`));
    expect(events).toContain(`dispose:${run2.id}`);
  });

  it('drains the prior stream before requesting the next step, not after', async () => {
    const setup = buildSetupStep();
    const run1 = buildRunStep({id: '00000000-0000-0000-0000-0000000000d1', position: 1});
    const run2 = buildRunStep({id: '00000000-0000-0000-0000-0000000000d2', position: 2});
    // Record each pull in the ordered event log so we can assert it relative to the drain.
    const responses = [
      stepResponse(setup, 1),
      stepResponse(run1, 1),
      stepResponse(run2, 1),
      {kind: 'done', status: 'succeeded'},
    ];
    let pull = 0;
    requestNextStepMock.mockImplementation(() => {
      events.push(`pull:${pull}`);
      return Promise.resolve(responses[pull++]);
    });
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    // pull index 2 is the request that claims run2. run1's stream must be disposed before it,
    // so a slow drain delays only the (unclaimed) pull, never a freshly claimed step.
    expect(events.indexOf(`dispose:${run1.id}`)).toBeLessThan(events.indexOf('pull:2'));
  });

  it('drains and disposes the stream on abort, without reporting', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    const ac = new AbortController();
    executeRunStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({success: true, error: null, exit_code: 0});
    });

    await runLoop({signal: ac.signal});

    // Setup completed and was reported; the aborted run step is not.
    const reportedSteps = reportStepMock.mock.calls.map((call) => call[1].stepId);
    expect(reportedSteps).not.toContain(run.id);
    expect(events).toContain(`drain:${run.id}`);
    expect(events).toContain(`dispose:${run.id}`);
  });

  it('reports the setup step failed with its reason, then stops on cancel:true (no user step runs)', async () => {
    const setup = buildSetupStep();
    const error = {message: 'mkdir denied', reason: 'workspace_prep_failed' as const};
    requestNextStepMock.mockResolvedValueOnce(stepResponse(setup, 1));
    executeSetupStepMock.mockResolvedValueOnce({success: false, error, exit_code: null});
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: setup.id,
      attempt: 1,
      status: 'failed',
      error,
      exitCode: null,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(createStepLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: setup.id,
      attempt: 1,
      secrets: [],
      append: expect.any(Function),
    });
    expect(events).toContain(`drain:${setup.id}`);
    expect(events).toContain(`dispose:${setup.id}`);
    expect(requestNextStepMock).toHaveBeenCalledTimes(1);
  });

  it('fails a run step dispatched before setup without spawning it', async () => {
    const run = buildRunStep();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(run, 1));
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(createStepLogStreamMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'failed',
      error: {message: 'Run step dispatched before setup prepared the workspace'},
      exitCode: null,
      logOutcome: 'drained',
      signal: ac.signal,
    });
  });

  it('stops immediately when there are no steps', async () => {
    requestNextStepMock.mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('stops without throwing on a 404 from next', async () => {
    requestNextStepMock.mockRejectedValueOnce(buildHTTPError(404));
    const ac = new AbortController();

    await expect(runLoop({signal: ac.signal})).resolves.toBeUndefined();

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('rethrows non-404 errors from next (loop bails, no re-pull)', async () => {
    requestNextStepMock.mockRejectedValueOnce(buildHTTPError(500));
    const ac = new AbortController();

    await expect(runLoop({signal: ac.signal})).rejects.toThrow();

    expect(requestNextStepMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run step with its exit_code after setup, then stops on cancel:true', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    const error = {message: 'Command exited with code 1', exit_code: 1};
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({success: false, error, exit_code: 1});
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'failed',
      error,
      exitCode: 1,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(2);
    const stream = streamFor(run.id);
    expect(stream.writeOutputLine).toHaveBeenCalledWith(
      'Process completed with exit code 1.',
      'stderr',
    );
    expect(events.indexOf(`line:${run.id}`)).toBeLessThan(events.indexOf(`close:${run.id}`));
  });

  it('writes terminal signal context for a failed run step before closing the stream', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    const error = {message: 'Killed by signal SIGKILL', exit_code: null, signal: 'SIGKILL'};
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({success: false, error, exit_code: null});
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    const stream = streamFor(run.id);
    expect(stream.writeOutputLine).toHaveBeenCalledWith(
      'Process terminated by signal SIGKILL.',
      'stderr',
    );
    expect(events.indexOf(`line:${run.id}`)).toBeLessThan(events.indexOf(`close:${run.id}`));
  });

  it('reports the step failed when executeRunStep throws (no leaked error, no hung step)', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 2));
    executeRunStepMock.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await expect(runLoop({signal: ac.signal})).resolves.toBeUndefined();

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 2,
      status: 'failed',
      error: {message: 'ENOSPC: no space left on device'},
      exitCode: null,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    const stream = streamFor(run.id);
    expect(stream.writeOutputLine).toHaveBeenCalledWith(
      'Process failed: ENOSPC: no space left on device',
      'stderr',
    );
  });

  it('does not report when the signal aborts during setup', async () => {
    const setup = buildSetupStep();
    const ac = new AbortController();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(setup, 1));
    executeSetupStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({success: true, error: null, exit_code: 0});
    });

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('does nothing when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();

    await runLoop({signal: ac.signal});

    expect(requestNextStepMock).not.toHaveBeenCalled();
  });

  it('dispatches an agent step to executeAgentStep against the prepared cwd, reporting it', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, output: '', error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(agent, {
      signal: ac.signal,
      cwd: '/work',
      runtime: {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {api_key: 'sk-runtime-secret'},
      },
      onSessionEntry: expect.any(Function),
    });
    expect(requestAgentRuntimeConfigMock).toHaveBeenCalledWith(leaseClient, {
      stepId: agent.id,
      attempt: 1,
      signal: ac.signal,
    });
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: agent.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      logOutcome: 'drained',
      signal: ac.signal,
    });
  });

  it('uses provider, model, and thinking from runtime config instead of stale step config', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep({
      config: {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix it.',
      },
    });
    requestAgentRuntimeConfigMock.mockResolvedValueOnce({
      provider_id: 'openai',
      model: 'gpt-5.1',
      thinking: 'medium',
      credentials: {api_key: 'sk-openai-runtime'},
    });
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, output: '', error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(
      agent,
      expect.objectContaining({
        runtime: {
          provider: 'openai',
          model: 'gpt-5.1',
          thinking: 'medium',
          credentials: {api_key: 'sk-openai-runtime'},
        },
      }),
    );
  });

  it('opens a session stream for an agent step, forwards entries, and settles it', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const sessionStream = makeFakeStream(agent.id);
    createSessionLogStreamMock.mockReturnValue(sessionStream);
    executeAgentStepMock.mockImplementation(
      (_step: StepDto, opts: {onSessionEntry?: (line: string) => void}) => {
        opts.onSessionEntry?.('{"type":"message","id":"a"}');
        return Promise.resolve({success: true, output: '', error: null, exit_code: 0});
      },
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal, secrets: ['s3cr3t']});

    expect(createSessionLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: agent.id,
      attempt: 1,
      secrets: ['s3cr3t', 'sk-runtime-secret'],
      append: expect.any(Function),
    });
    expect(sessionStream.writeEntry).toHaveBeenCalledWith('{"type":"message","id":"a"}');
    expect(sessionStream.close).toHaveBeenCalled();
    expect(sessionStream.drain).toHaveBeenCalled();
    expect(sessionStream.dispose).toHaveBeenCalled();
  });

  it('runs and reports an agent step when opening the session stream fails (capture abandoned)', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    // Opening the session spool throws (e.g. a broken logs dir): capture must be abandoned, not
    // fatal to the step, and the agent runs without a session sink (no onSessionEntry).
    createSessionLogStreamMock.mockImplementationOnce(() => {
      throw new Error('logs dir is a file');
    });
    executeAgentStepMock.mockResolvedValue({success: true, output: '', error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(agent, {
      signal: ac.signal,
      cwd: '/work',
      runtime: {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {api_key: 'sk-runtime-secret'},
      },
    });
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: agent.id, status: 'succeeded', logOutcome: 'abandoned'}),
    );
  });

  it('does not report the agent step when the signal aborts mid-run', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    const ac = new AbortController();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1));
    executeAgentStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({
        success: false,
        output: '',
        error: {message: 'Agent step aborted', reason: 'agent_invocation_failed' as const},
        exit_code: null,
      });
    });

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledTimes(1);
    // Only the setup step is reported; the aborted agent step is not.
    expect(reportStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).not.toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: agent.id}),
    );
  });

  it('redacts runtime credential values from agent failures and blanks output before reporting', async () => {
    const agent = buildAgentStep();
    const hexCredential = Buffer.from('sk-runtime-secret').toString('hex');
    executeAgentStepMock.mockResolvedValue({
      success: false,
      output: 'provider echoed sk-runtime-secret',
      error: {
        message: `provider rejected sk-runtime-secret and ${hexCredential}`,
        reason: 'agent_invocation_failed' as const,
      },
      exit_code: null,
    });
    const ac = new AbortController();

    const execution = await executeStep({
      step: agent,
      attempt: 1,
      cwd: '/work',
      logsDir: LOGS_DIR,
      jobContext: JOB_CONTEXT,
      leaseClient,
      secrets: [],
      signal: ac.signal,
      workspacePrepared: true,
      jobId: JOB_ID,
      stepLabel: 'implement',
    });

    expect(execution.result).toEqual({
      success: false,
      output: '',
      error: {
        message: 'provider rejected *** and ***',
        reason: 'agent_invocation_failed',
      },
      exit_code: null,
    });
  });

  it('reports agent config issues when runtime credentials are rejected by the API', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'failed'});
    requestAgentRuntimeConfigMock.mockRejectedValueOnce(
      new AgentRuntimeConfigRequestError(
        409,
        'agent-provider-not-configured',
        'provider_not_configured',
      ),
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: agent.id,
        status: 'failed',
        error: expect.objectContaining({
          reason: 'agent_config_invalid',
          agent_config_issue: 'provider_not_configured',
        }),
      }),
    );
  });
});

function buildSetupStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({
    id: '00000000-0000-0000-0000-0000000000b0',
    name: 'Set up job',
    type: 'setup',
    config: {},
    position: 0,
    ...overrides,
  });
}

function buildRunStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({position: 1, ...overrides});
}

function buildAgentStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({
    id: '00000000-0000-0000-0000-0000000000c0',
    name: 'implement',
    type: 'agent',
    config: {model: 'claude-opus-4-8', thinking: 'high', prompt: 'Fix it.'},
    position: 1,
    ...overrides,
  });
}

function buildStep(overrides: Partial<StepDto> = {}): StepDto {
  const displayName =
    overrides.display_name ??
    (typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'test-step');
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    name: 'test-step',
    display_name: displayName,
    source_location: null,
    status: 'running',
    type: 'run',
    config: {run: 'echo test'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stepResponse(step: StepDto, attempt: number): NextStepResponseDto {
  return {kind: 'step', step, attempt};
}

function buildHTTPError(status: number): HTTPError {
  const response = {status} as Response;
  const request = {} as Request;
  const options = {} as ConstructorParameters<typeof HTTPError>[2];
  return new HTTPError(response, request, options);
}
