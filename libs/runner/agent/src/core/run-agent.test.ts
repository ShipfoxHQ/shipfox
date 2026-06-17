const {createAgentSessionMock, findMock, promptMock, abortMock} = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  findMock: vi.fn(),
  promptMock: vi.fn(),
  abortMock: vi.fn(),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: createAgentSessionMock,
  AuthStorage: {create: () => ({})},
  ModelRegistry: {create: () => ({find: findMock})},
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
    findMock.mockReset();
    promptMock.mockReset();
    abortMock.mockReset();
    findMock.mockReturnValue({id: 'claude-opus-4-8'});
    promptMock.mockResolvedValue(undefined);
    createAgentSessionMock.mockResolvedValue({
      session: {prompt: promptMock, abort: abortMock, messages: []},
    });
  });

  it('resolves a bare model id under the anthropic provider and runs the prompt', async () => {
    const result = await runAgent(invocation());

    expect(findMock).toHaveBeenCalledWith('anthropic', 'claude-opus-4-8');
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/work',
        thinkingLevel: 'high',
        model: {id: 'claude-opus-4-8'},
      }),
    );
    expect(promptMock).toHaveBeenCalledWith('Fix it.');
    expect(result).toEqual({});
  });

  it('splits a provider/modelId spec on the first slash', async () => {
    await runAgent(invocation({model: 'openrouter/anthropic/claude'}));

    expect(findMock).toHaveBeenCalledWith('openrouter', 'anthropic/claude');
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

  it('throws when the model cannot be resolved', async () => {
    findMock.mockReturnValue(undefined);

    await expect(runAgent(invocation({model: 'bogus'}))).rejects.toThrow('Unknown agent model');
  });
});
