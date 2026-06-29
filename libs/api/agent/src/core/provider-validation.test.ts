import type {AssistantMessage, Context, ProviderStreamOptions} from '@earendil-works/pi-ai';
import {InvalidAgentModelError} from './errors.js';
import {probeProviderCredentials, sanitizeProviderError} from './provider-validation.js';

const piAi = vi.hoisted(() => ({
  complete: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai', () => piAi);

describe('probeProviderCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    piAi.getModels.mockReturnValue([
      {
        id: 'claude-opus-4-8',
        provider: 'anthropic',
        api: 'anthropic-messages',
        name: 'Claude Opus',
        baseUrl: 'https://api.anthropic.com',
        reasoning: true,
        input: ['text'],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 200000,
        maxTokens: 32000,
      },
    ]);
    piAi.complete.mockResolvedValue(createAssistantMessage());
  });

  it('resolves the catalog model and sends the catalog secret field as apiKey', async () => {
    const credentials = {api_key: 'sk-ant-secret'};

    await probeProviderCredentials({
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials,
    });

    expect(piAi.getModels).toHaveBeenCalledWith('anthropic');
    const [model, context, options] = piAi.complete.mock.calls[0] as [
      {id: string},
      Context,
      ProviderStreamOptions,
    ];
    expect(model.id).toBe('claude-opus-4-8');
    expect(context.messages).toHaveLength(1);
    expect(options).toMatchObject({
      apiKey: 'sk-ant-secret',
      maxRetries: 0,
      maxTokens: 64,
      timeoutMs: 10000,
    });
  });

  it('throws InvalidAgentModelError when the catalog model is missing from Pi', async () => {
    piAi.getModels.mockReturnValue([]);

    const probe = probeProviderCredentials({
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials: {api_key: 'sk-ant-secret'},
    });

    await expect(probe).rejects.toThrow(InvalidAgentModelError);
    expect(piAi.complete).not.toHaveBeenCalled();
  });

  it('rejects provider error results from Pi complete', async () => {
    piAi.complete.mockResolvedValue(
      createAssistantMessage({stopReason: 'error', errorMessage: '401 Unauthorized'}),
    );

    const probe = probeProviderCredentials({
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials: {api_key: 'sk-ant-secret'},
    });

    await expect(probe).rejects.toThrow('401 Unauthorized');
  });

  it('passes Azure endpoint credentials as Pi Azure base URL options', async () => {
    piAi.getModels.mockReturnValue([
      {
        id: 'gpt-5.5-pro',
        provider: 'azure-openai-responses',
        api: 'azure-openai-responses',
        name: 'GPT',
        baseUrl: '',
        reasoning: true,
        input: ['text'],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 200000,
        maxTokens: 32000,
      },
    ]);

    await probeProviderCredentials({
      providerId: 'azure-openai-responses',
      model: 'gpt-5.5-pro',
      credentials: {
        endpoint: 'https://azure.example.test/openai/v1',
        api_key: 'sk-azure-secret',
      },
    });

    const [, , options] = piAi.complete.mock.calls[0] as [
      {id: string},
      Context,
      ProviderStreamOptions,
    ];
    expect(options).toMatchObject({
      apiKey: 'sk-azure-secret',
      azureBaseUrl: 'https://azure.example.test/openai/v1',
    });
  });

  it('passes Cloudflare AI Gateway credentials through provider env options', async () => {
    piAi.getModels.mockReturnValue([
      {
        id: 'claude-opus-4-8',
        provider: 'cloudflare-ai-gateway',
        api: 'anthropic-messages',
        name: 'Claude',
        baseUrl:
          'https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic',
        reasoning: true,
        input: ['text'],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 200000,
        maxTokens: 32000,
      },
    ]);

    await probeProviderCredentials({
      providerId: 'cloudflare-ai-gateway',
      model: 'claude-opus-4-8',
      credentials: {
        api_key: 'cf-secret',
        account_id: 'account-123',
        gateway_id: 'gateway-456',
      },
    });

    const [, , options] = piAi.complete.mock.calls[0] as [
      {id: string},
      Context,
      ProviderStreamOptions,
    ];
    expect(options).toMatchObject({
      apiKey: 'cf-secret',
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'account-123',
        CLOUDFLARE_GATEWAY_ID: 'gateway-456',
      },
    });
  });

  it('passes Cloudflare Workers AI credentials through provider env options', async () => {
    piAi.getModels.mockReturnValue([
      {
        id: '@cf/moonshotai/kimi-k2.7-code',
        provider: 'cloudflare-workers-ai',
        api: 'openai-completions',
        name: 'Kimi',
        baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1',
        reasoning: true,
        input: ['text'],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 200000,
        maxTokens: 32000,
      },
    ]);

    await probeProviderCredentials({
      providerId: 'cloudflare-workers-ai',
      model: '@cf/moonshotai/kimi-k2.7-code',
      credentials: {
        api_key: 'cf-secret',
        account_id: 'account-123',
      },
    });

    const [, , options] = piAi.complete.mock.calls[0] as [
      {id: string},
      Context,
      ProviderStreamOptions,
    ];
    expect(options).toMatchObject({
      apiKey: 'cf-secret',
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'account-123',
      },
    });
  });
});

function createAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{type: 'text', text: 'OK'}],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('sanitizeProviderError', () => {
  it('redacts literal and derived secret wire forms from provider messages', () => {
    const secret = 'sk-ant-api-key-secret-abcd';
    const base64Secret = Buffer.from(secret, 'utf8').toString('base64');
    const error = new Error(`Authentication failed for ${secret} and ${base64Secret}`);

    const sanitized = sanitizeProviderError(error, [secret]);

    expect(sanitized).not.toContain(secret);
    expect(sanitized).not.toContain(base64Secret);
    expect(sanitized).toContain('***');
  });

  it('caps long provider messages', () => {
    const error = new Error('x'.repeat(1000));

    const sanitized = sanitizeProviderError(error, ['sk-ant-secret']);

    expect(sanitized).toHaveLength(500);
  });

  it('omits the stack from Error objects', () => {
    const error = new Error('Provider said no');

    const sanitized = sanitizeProviderError(error, []);

    expect(sanitized).toBe('Provider said no');
    expect(sanitized).not.toContain('at ');
  });

  it('handles non-Error thrown values', () => {
    const sanitized = sanitizeProviderError('raw thrown value', ['secret']);

    expect(sanitized).toBe('Provider validation failed.');
  });
});
