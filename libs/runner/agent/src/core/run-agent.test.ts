const {createAgentSessionMock, findMock, getAllMock, hasConfiguredAuthMock, promptMock, abortMock} =
  vi.hoisted(() => ({
    createAgentSessionMock: vi.fn(),
    findMock: vi.fn(),
    getAllMock: vi.fn(),
    hasConfiguredAuthMock: vi.fn(),
    promptMock: vi.fn(),
    abortMock: vi.fn(),
  }));
const {authStorageCreateMock, authStorageInMemoryMock} = vi.hoisted(() => ({
  authStorageCreateMock: vi.fn(),
  authStorageInMemoryMock: vi.fn(),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: createAgentSessionMock,
  AuthStorage: {create: authStorageCreateMock, inMemory: authStorageInMemoryMock},
  ModelRegistry: {
    create: () => ({
      find: findMock,
      getAll: getAllMock,
      hasConfiguredAuth: hasConfiguredAuthMock,
    }),
  },
  SessionManager: {create: () => ({})},
}));

import {appendFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentConfigError} from '#core/errors.js';
import {type AgentInvocation, runAgent} from '#core/run-agent.js';

function invocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    cwd: '/work',
    model: 'claude-opus-4-8',
    provider: 'anthropic',
    thinking: 'high',
    prompt: 'Fix it.',
    credentials: {api_key: 'sk-runtime-secret'},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('runAgent', () => {
  // Tracked so the temp dir is removed in afterEach even if an assertion throws first.
  let sessionDir: string | undefined;

  beforeEach(() => {
    createAgentSessionMock.mockReset();
    findMock.mockReset();
    getAllMock.mockReset();
    hasConfiguredAuthMock.mockReset();
    promptMock.mockReset();
    abortMock.mockReset();
    authStorageCreateMock.mockReset();
    authStorageInMemoryMock.mockReset();
    authStorageCreateMock.mockReturnValue({});
    authStorageInMemoryMock.mockReturnValue({});
    findMock.mockReturnValue({provider: 'anthropic', id: 'claude-opus-4-8'});
    getAllMock.mockReturnValue([{provider: 'anthropic', id: 'claude-opus-4-8'}]);
    hasConfiguredAuthMock.mockReturnValue(true);
    promptMock.mockResolvedValue(undefined);
    createAgentSessionMock.mockResolvedValue({
      session: {prompt: promptMock, abort: abortMock, messages: []},
    });
  });

  afterEach(() => {
    expect(authStorageCreateMock).not.toHaveBeenCalled();
    if (sessionDir) rmSync(sessionDir, {recursive: true, force: true});
    sessionDir = undefined;
  });

  it('resolves the configured model under the requested provider and runs the prompt', async () => {
    const model = {provider: 'openai', id: 'gpt-5.1'};
    findMock.mockReturnValue(model);

    const result = await runAgent(invocation({provider: 'openai', model: 'gpt-5.1'}));

    expect(findMock).toHaveBeenCalledWith('openai', 'gpt-5.1');
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({cwd: '/work', thinkingLevel: 'high', model}),
    );
    expect(promptMock).toHaveBeenCalledWith('Fix it.');
    expect(result).toEqual({});
  });

  it('injects runtime credentials into in-memory pi auth storage without persisting them', async () => {
    const model = {provider: 'openai', id: 'gpt-5.1'};
    findMock.mockReturnValue(model);

    await runAgent(
      invocation({
        provider: 'openai',
        model: 'gpt-5.1',
        credentials: {api_key: 'sk-runtime-secret'},
      }),
    );

    expect(authStorageInMemoryMock).toHaveBeenCalledWith({
      openai: {type: 'api_key', key: 'sk-runtime-secret'},
    });
    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({model}));
  });

  it('maps Azure runtime credentials into pi provider env', async () => {
    const model = {provider: 'azure-openai-responses', id: 'gpt-5.5-pro'};
    findMock.mockReturnValue(model);

    await runAgent(
      invocation({
        provider: 'azure-openai-responses',
        model: 'gpt-5.5-pro',
        credentials: {
          endpoint: 'https://shipfox.openai.azure.com',
          api_key: 'sk-azure-secret',
        },
      }),
    );

    expect(authStorageInMemoryMock).toHaveBeenCalledWith({
      'azure-openai-responses': {
        type: 'api_key',
        key: 'sk-azure-secret',
        env: {AZURE_OPENAI_BASE_URL: 'https://shipfox.openai.azure.com'},
      },
    });
  });

  it('maps Cloudflare runtime credentials into pi provider env', async () => {
    const model = {provider: 'cloudflare-ai-gateway', id: 'claude-opus-4-8'};
    findMock.mockReturnValue(model);

    await runAgent(
      invocation({
        provider: 'cloudflare-ai-gateway',
        model: 'claude-opus-4-8',
        credentials: {
          api_key: 'cf-secret',
          account_id: 'account-1',
          gateway_id: 'gateway-1',
        },
      }),
    );

    expect(authStorageInMemoryMock).toHaveBeenCalledWith({
      'cloudflare-ai-gateway': {
        type: 'api_key',
        key: 'cf-secret',
        env: {
          CLOUDFLARE_ACCOUNT_ID: 'account-1',
          CLOUDFLARE_GATEWAY_ID: 'gateway-1',
        },
      },
    });
  });

  it('throws an AgentConfigError when runtime credentials have no API key', async () => {
    await expect(
      runAgent(invocation({provider: 'openai', credentials: {account_id: 'acct-1'}})),
    ).rejects.toThrow(
      new AgentConfigError('Runtime credentials for provider "openai" are missing "api_key".'),
    );
    expect(findMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError when provider-specific runtime fields are missing', async () => {
    await expect(
      runAgent(
        invocation({
          provider: 'cloudflare-ai-gateway',
          credentials: {api_key: 'cf-secret', account_id: 'account-1'},
        }),
      ),
    ).rejects.toThrow(
      new AgentConfigError(
        'Runtime credentials for provider "cloudflare-ai-gateway" are missing "gateway_id".',
      ),
    );
    expect(findMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('forwards each persisted session entry to onSessionEntry in order', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-run-agent-'));
    const sessionFile = join(sessionDir, 'session.jsonl');
    // pi persists entries to the session file during the turn; the final read on completion
    // forwards everything written before the prompt resolved.
    promptMock.mockImplementation(() => {
      appendFileSync(sessionFile, '{"type":"session"}\n{"type":"message","id":"a"}\n');
      return Promise.resolve();
    });
    createAgentSessionMock.mockResolvedValue({
      session: {prompt: promptMock, abort: abortMock, messages: [], sessionFile},
    });
    const entries: string[] = [];

    await runAgent(invocation({onSessionEntry: (line) => entries.push(line)}));

    expect(entries).toEqual(['{"type":"session"}', '{"type":"message","id":"a"}']);
  });

  it('skips forwarding when the session is not persisted (no session file)', async () => {
    const entries: string[] = [];

    await runAgent(invocation({onSessionEntry: (line) => entries.push(line)}));

    expect(entries).toEqual([]);
  });

  it('throws an AgentConfigError naming the provider when it is unknown', async () => {
    findMock.mockReturnValue(undefined);
    getAllMock.mockReturnValue([{provider: 'anthropic', id: 'claude-opus-4-8'}]);

    await expect(runAgent(invocation({provider: 'bogus', model: 'gpt-5.1'}))).rejects.toThrow(
      new AgentConfigError(
        'Unknown provider "bogus" for agent step. ' +
          'Known providers are pi built-ins plus any from models.json.',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError with a did-you-mean hint when the model is on another provider', async () => {
    findMock.mockReturnValue(undefined);
    getAllMock.mockReturnValue([
      {provider: 'anthropic', id: 'claude-opus-4-8'},
      {provider: 'openai', id: 'gpt-5.1'},
    ]);

    await expect(runAgent(invocation({provider: 'anthropic', model: 'gpt-5.1'}))).rejects.toThrow(
      new AgentConfigError(
        'Model "gpt-5.1" is not available for provider "anthropic". ' +
          'Did you mean to set provider: openai?',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError without a hint when no provider carries the model', async () => {
    findMock.mockReturnValue(undefined);
    getAllMock.mockReturnValue([{provider: 'anthropic', id: 'claude-opus-4-8'}]);

    await expect(runAgent(invocation({provider: 'anthropic', model: 'gpt-5.1'}))).rejects.toThrow(
      new AgentConfigError('Model "gpt-5.1" is not available for provider "anthropic".'),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError when the provider has no configured workspace credentials', async () => {
    findMock.mockReturnValue({provider: 'openai', id: 'gpt-5.1'});
    hasConfiguredAuthMock.mockReturnValue(false);

    await expect(runAgent(invocation({provider: 'openai', model: 'gpt-5.1'}))).rejects.toThrow(
      new AgentConfigError(
        'No credentials configured for provider "openai". ' +
          'Verify the provider is configured for this workspace.',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('aborts the pi session when the signal fires', async () => {
    const ac = new AbortController();
    let resolvePrompt: () => void = () => undefined;
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
    let resolveCreate: (value: {session: unknown}) => void = () => undefined;
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
