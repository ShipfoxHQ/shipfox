import {vi} from '@shipfox/vitest/vi';
import {DiscordIntegrationProviderError} from '#core/errors.js';
import {createDiscordApiClient, DISCORD_API_TIMEOUT_MS} from './client.js';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json', ...headers},
  });
}

type FetchMock = {mock: {calls: unknown[][]}};

function stubFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn<(input: Request | URL, init?: RequestInit) => Promise<Response>>();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentRequest(fetchMock: FetchMock, index = 0): Request {
  const request = fetchMock.mock.calls[index]?.[0];
  if (!(request instanceof Request)) throw new Error('Expected a Request');
  return request;
}

async function rejection(promise: Promise<unknown>): Promise<DiscordIntegrationProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DiscordIntegrationProviderError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail');
}

describe('Discord REST client', () => {
  const client = createDiscordApiClient({
    botToken: 'bot-token',
    baseUrl: 'https://discord.test/api/v10/',
    applicationId: 'app-1',
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('requests', () => {
    it('sends the bot authorization header to the configured base URL', async () => {
      const fetchMock = stubFetch(json({id: 'guild-1', name: 'Shipfox', roles: []}));

      const guild = await client.getGuild({guildId: 'guild-1'});

      const request = sentRequest(fetchMock);
      expect(guild).toEqual({id: 'guild-1', name: 'Shipfox', roles: []});
      expect(request.method).toBe('GET');
      expect(request.url).toBe('https://discord.test/api/v10/guilds/guild-1');
      expect(request.headers.get('authorization')).toBe('Bot bot-token');
    });

    it('defaults to the Discord configuration', async () => {
      const fetchMock = stubFetch(json({id: 'channel-1', type: 0}));

      await createDiscordApiClient().getChannel({channelId: 'channel-1'});

      const request = sentRequest(fetchMock);
      expect(request.url).toBe('https://discord.config.test/api/v10/channels/channel-1');
      expect(request.headers.get('authorization')).toBe('Bot test-discord-bot-token');
    });

    it('reads a channel', async () => {
      stubFetch(json({id: 'channel-1', type: 11, guild_id: 'guild-1', parent_id: 'channel-0'}));

      await expect(client.getChannel({channelId: 'channel-1'})).resolves.toEqual({
        id: 'channel-1',
        type: 11,
        guild_id: 'guild-1',
        parent_id: 'channel-0',
      });
    });

    it('leaves a guild and accepts the empty response', async () => {
      const fetchMock = stubFetch(new Response(null, {status: 204}));

      await expect(client.leaveGuild({guildId: 'guild-1'})).resolves.toBeUndefined();

      const request = sentRequest(fetchMock);
      expect(request.method).toBe('DELETE');
      expect(request.url).toBe('https://discord.test/api/v10/users/@me/guilds/guild-1');
    });

    it('reads the gateway bot session limit', async () => {
      const gateway = {
        url: 'wss://gateway.discord.gg',
        shards: 1,
        session_start_limit: {total: 1000, remaining: 998, reset_after: 5000, max_concurrency: 1},
      };
      const fetchMock = stubFetch(json(gateway));

      await expect(client.getGatewayBot()).resolves.toEqual(gateway);

      expect(sentRequest(fetchMock).url).toBe('https://discord.test/api/v10/gateway/bot');
    });

    it('lists the application commands', async () => {
      const fetchMock = stubFetch(json([{id: 'command-1', name: 'shipfox', type: 1}]));

      await expect(client.listApplicationCommands()).resolves.toEqual([
        {id: 'command-1', name: 'shipfox', type: 1},
      ]);

      expect(sentRequest(fetchMock).url).toBe(
        'https://discord.test/api/v10/applications/app-1/commands',
      );
    });

    it('overwrites the application commands in bulk', async () => {
      const commands = [{name: 'Send to Shipfox', type: 3, contexts: [0]}] as const;
      let requestBody: unknown;
      const fetchMock = vi.fn(async (input: Request | URL) => {
        if (input instanceof Request) requestBody = await input.clone().json();
        return json([{id: 'command-1', name: 'Send to Shipfox', type: 3}]);
      });
      vi.stubGlobal('fetch', fetchMock);

      await client.overwriteApplicationCommands({commands});

      const request = sentRequest(fetchMock);
      expect(request.method).toBe('PUT');
      expect(request.url).toBe('https://discord.test/api/v10/applications/app-1/commands');
      expect(requestBody).toEqual(commands);
    });
  });

  describe('error mapping', () => {
    it('maps 401 to unavailable credentials', async () => {
      stubFetch(json({code: 0, message: '401: Unauthorized'}, 401));

      const error = await rejection(client.getGuild({guildId: 'guild-1'}));

      expect(error).toMatchObject({reason: 'credentials-unavailable', status: 401});
    });

    it.each([50001, 50013])('maps 403 with Discord code %i to access denied', async (code) => {
      stubFetch(json({code, message: 'Missing'}, 403));

      const error = await rejection(client.getChannel({channelId: 'channel-1'}));

      expect(error).toMatchObject({reason: 'access-denied', status: 403, discordCode: code});
    });

    it('maps 404 to not found', async () => {
      stubFetch(json({code: 10003, message: 'Unknown Channel'}, 404));

      const error = await rejection(client.getChannel({channelId: 'channel-1'}));

      expect(error).toMatchObject({reason: 'not-found', status: 404, discordCode: 10003});
    });

    it('maps 429 to rate limited with the body retry_after rounded up', async () => {
      stubFetch(
        json({message: 'You are being rate limited.', retry_after: 1.2, global: false}, 429),
      );

      const error = await rejection(client.getGuild({guildId: 'guild-1'}));

      expect(error).toMatchObject({reason: 'rate-limited', status: 429, retryAfterSeconds: 2});
    });

    it('falls back to the Retry-After header when the 429 body has no retry_after', async () => {
      stubFetch(new Response('rate limited', {status: 429, headers: {'retry-after': '7'}}));

      const error = await rejection(client.getGuild({guildId: 'guild-1'}));

      expect(error).toMatchObject({reason: 'rate-limited', retryAfterSeconds: 7});
    });

    it('maps 5xx to provider unavailable', async () => {
      stubFetch(new Response('bad gateway', {status: 502}));

      const error = await rejection(client.getGuild({guildId: 'guild-1'}));

      expect(error).toMatchObject({reason: 'provider-unavailable', status: 502});
    });

    it('maps other 4xx to provider rejected', async () => {
      stubFetch(json({code: 50035, message: 'Invalid Form Body'}, 400));

      const error = await rejection(client.overwriteApplicationCommands({commands: []}));

      expect(error).toMatchObject({reason: 'provider-rejected', status: 400, discordCode: 50035});
    });

    it('maps a timeout to timeout', async () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            (input: Request) =>
              new Promise<Response>((_resolve, reject) => {
                input.signal.addEventListener('abort', () => reject(input.signal.reason));
              }),
          ),
        );

        const pending = rejection(client.getGuild({guildId: 'guild-1'}));
        await vi.advanceTimersByTimeAsync(DISCORD_API_TIMEOUT_MS + 1);

        await expect(pending).resolves.toMatchObject({reason: 'timeout'});
      } finally {
        vi.useRealTimers();
      }
    });

    it('maps a network failure to provider unavailable', async () => {
      stubFetch(new TypeError('fetch failed'));

      const error = await rejection(client.getGuild({guildId: 'guild-1'}));

      expect(error).toMatchObject({reason: 'provider-unavailable'});
    });

    it.each([401, 403, 429, 500])('never retries a %i answer', async (status) => {
      const fetchMock = stubFetch(
        json({retry_after: 0}, status),
        json({retry_after: 0}, status),
        json({retry_after: 0}, status),
      );

      await rejection(client.getGuild({guildId: 'guild-1'}));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
