import {reportError} from '@shipfox/node-error-monitoring';
import type {DiscordGatewayBot} from '#api/client.js';
import {createIdentifyGuard} from './gateway-identify-guard.js';

vi.mock('@shipfox/node-error-monitoring', () => ({reportError: vi.fn()}));

function gatewayBot(overrides: {
  remaining?: number;
  resetAfterMs?: number;
  shards?: number;
}): DiscordGatewayBot {
  return {
    url: 'wss://gateway.discord.test',
    shards: overrides.shards ?? 1,
    session_start_limit: {
      total: 1000,
      remaining: overrides.remaining ?? 1000,
      reset_after: overrides.resetAfterMs ?? 0,
      max_concurrency: 1,
    },
  };
}

describe('Identify guard', () => {
  afterEach(() => {
    vi.mocked(reportError).mockClear();
  });

  it('lets an Identify through when the budget is healthy', async () => {
    const getGatewayBot = vi.fn().mockResolvedValue(gatewayBot({}));
    const guard = createIdentifyGuard({getGatewayBot, spacingMs: 1});

    await guard.waitForIdentify(0, new AbortController().signal);

    expect(getGatewayBot).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('spaces Identify calls apart', async () => {
    const guard = createIdentifyGuard({
      getGatewayBot: () => Promise.resolve(gatewayBot({})),
      spacingMs: 150,
    });
    const signal = new AbortController().signal;

    await guard.waitForIdentify(0, signal);
    const secondStartedAt = Date.now();
    await guard.waitForIdentify(0, signal);

    expect(Date.now() - secondStartedAt).toBeGreaterThanOrEqual(140);
  });

  it('refuses below 100 remaining, reports it, and waits for the reset', async () => {
    const getGatewayBot = vi
      .fn()
      .mockResolvedValueOnce(gatewayBot({remaining: 99, resetAfterMs: 20}))
      .mockResolvedValue(gatewayBot({remaining: 1000}));
    const guard = createIdentifyGuard({getGatewayBot, spacingMs: 20});

    await guard.waitForIdentify(0, new AbortController().signal);

    expect(getGatewayBot).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0]?.[1]).toEqual({
      boundary: 'integrations.discord.gateway',
    });
  });

  it('allows an Identify at exactly 100 remaining', async () => {
    const getGatewayBot = vi.fn().mockResolvedValue(gatewayBot({remaining: 100}));
    const guard = createIdentifyGuard({getGatewayBot, spacingMs: 1});

    await guard.waitForIdentify(0, new AbortController().signal);

    expect(getGatewayBot).toHaveBeenCalledTimes(1);
  });

  it('waits and retries instead of throwing when the budget check fails', async () => {
    const getGatewayBot = vi
      .fn()
      .mockRejectedValueOnce(new Error('Discord is down'))
      .mockResolvedValue(gatewayBot({}));
    const guard = createIdentifyGuard({getGatewayBot, spacingMs: 1, backoffMs: () => 10});

    await guard.waitForIdentify(0, new AbortController().signal);

    expect(getGatewayBot).toHaveBeenCalledTimes(2);
  });

  it('reports a recommended shard count above one once and still identifies', async () => {
    const guard = createIdentifyGuard({
      getGatewayBot: () => Promise.resolve(gatewayBot({shards: 3})),
      spacingMs: 1,
    });
    const signal = new AbortController().signal;

    await guard.waitForIdentify(0, signal);
    await guard.waitForIdentify(0, signal);

    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('rejects when the shard closes while an Identify waits for the budget', async () => {
    const guard = createIdentifyGuard({
      getGatewayBot: () => Promise.resolve(gatewayBot({remaining: 0, resetAfterMs: 60_000})),
      spacingMs: 1,
    });
    const controller = new AbortController();

    const waiting = guard.waitForIdentify(0, controller.signal);
    setTimeout(() => controller.abort(), 30);

    await expect(waiting).rejects.toThrow();
  });
});
