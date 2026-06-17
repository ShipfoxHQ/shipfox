const {createAgentSessionMock, promptMock, abortMock} = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  promptMock: vi.fn(),
  abortMock: vi.fn(),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: createAgentSessionMock,
}));

import {type AgentInvocation, runAgent} from '#core/run-agent.js';

function invocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    cwd: '/work',
    model: 'claude-opus-4-8',
    thinking: 'high',
    prompt: 'Fix it.',
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('runAgent', () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset();
    promptMock.mockReset();
    abortMock.mockReset();
    promptMock.mockResolvedValue(undefined);
    createAgentSessionMock.mockResolvedValue({
      session: {prompt: promptMock, abort: abortMock, messages: []},
    });
  });

  it('starts a pi session for the cwd and thinking level and runs the prompt', async () => {
    const result = await runAgent(invocation());

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({cwd: '/work', thinkingLevel: 'high'}),
    );
    expect(promptMock).toHaveBeenCalledWith('Fix it.');
    expect(result).toEqual({});
  });

  it('aborts the pi session when the signal fires', async () => {
    const ac = new AbortController();
    let resolvePrompt: () => void = () => {
      // replaced by the mock implementation below
    };
    promptMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
    );

    const promise = runAgent(invocation({signal: ac.signal}));
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalled());
    ac.abort();

    expect(abortMock).toHaveBeenCalledTimes(1);
    resolvePrompt();
    await promise;
  });

  it('aborts the session and skips the prompt when the signal fires during session creation', async () => {
    const ac = new AbortController();
    let resolveCreate: (value: {session: unknown}) => void = () => {
      // replaced by the mock implementation below
    };
    createAgentSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const promise = runAgent(invocation({signal: ac.signal}));
    await vi.waitFor(() => expect(createAgentSessionMock).toHaveBeenCalled());
    ac.abort();
    resolveCreate({session: {prompt: promptMock, abort: abortMock, messages: []}});

    await expect(promise).rejects.toThrow('aborted');
    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(promptMock).not.toHaveBeenCalled();
  });

  it('does not run pi when the signal is already aborted on entry', async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(runAgent(invocation({signal: ac.signal}))).rejects.toThrow('aborted');
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });
});
