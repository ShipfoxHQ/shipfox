import type {Context, ProviderStreamOptions} from '@earendil-works/pi-ai';
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
    piAi.complete.mockResolvedValue(undefined);
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
});

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
