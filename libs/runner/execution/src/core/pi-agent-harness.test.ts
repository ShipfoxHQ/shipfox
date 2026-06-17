import type {AgentInvocation} from '#core/agent-harness.js';

const createAgentSessionMock = vi.fn();
const findMock = vi.fn();
const promptMock = vi.fn();
const abortMock = vi.fn();

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: (...args: unknown[]) => createAgentSessionMock(...args),
  AuthStorage: {create: () => ({})},
  ModelRegistry: {create: () => ({find: (...args: unknown[]) => findMock(...args)})},
}));

const {createPiAgentHarness} = await import('#core/pi-agent-harness.js');

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

describe('createPiAgentHarness', () => {
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
    const harness = createPiAgentHarness();

    const result = await harness.run(invocation());

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
    const harness = createPiAgentHarness();

    await harness.run(invocation({model: 'openrouter/anthropic/claude'}));

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
    const harness = createPiAgentHarness();

    const promise = harness.run(invocation({signal: ac.signal}));
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalled());
    ac.abort();

    expect(abortMock).toHaveBeenCalledTimes(1);
    resolvePrompt();
    await promise;
  });

  it('throws when the model cannot be resolved', async () => {
    findMock.mockReturnValue(undefined);
    const harness = createPiAgentHarness();

    await expect(harness.run(invocation({model: 'bogus'}))).rejects.toThrow('Unknown agent model');
  });
});
