import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {openPostgresSession} from '@shipfox/node-postgres';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {DiscordApiClient, DiscordGuild} from '#api/client.js';
import {DiscordIntegrationProviderError} from '#core/errors.js';
import type {ConnectDiscordInstallationInput} from '#core/install.js';
import {DISCORD_BOT_PERMISSIONS} from '#core/install.js';
import {signDiscordInstallState, verifyDiscordInstallState} from '#core/state.js';
import {discordGuildLockKey} from '#db/guild-lock.js';
import {createDiscordIntegrationProvider} from '#index.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const GUILD_ID = 'guild-1';
const APPLICATION_ID = 'test-discord-application-id';

let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

function guild(overrides: Partial<DiscordGuild> = {}): DiscordGuild {
  return {
    id: GUILD_ID,
    name: 'Acme',
    roles: [
      {id: 'everyone', name: '@everyone', managed: false, permissions: '0'},
      {
        id: 'bot-role',
        name: 'Shipfox',
        managed: true,
        permissions: '309237730368',
        tags: {bot_id: APPLICATION_ID},
      },
    ],
    ...overrides,
  };
}

function providerError(
  reason: 'not-found' | 'access-denied' | 'provider-unavailable',
  status: number,
) {
  return new DiscordIntegrationProviderError({reason, message: 'Discord failed', status});
}

const unused = () => Promise.reject(new Error('Not used by the install routes'));

function discordClient(
  overrides: Partial<
    Pick<DiscordApiClient, 'exchangeAuthorizationCode' | 'revokeAccessToken' | 'getGuild'>
  > = {},
) {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({accessToken: 'user-token', guild: {id: GUILD_ID, name: 'Acme'}}),
    ),
    revokeAccessToken: vi.fn(() => Promise.resolve()),
    getGuild: vi.fn(() => Promise.resolve(guild())),
    getChannel: unused,
    getMessage: unused,
    listChannelMessages: unused,
    listGuildChannels: unused,
    listActiveGuildThreads: unused,
    searchGuildMessages: unused,
    getGuildMember: unused,
    createMessage: unused,
    startThreadFromMessage: unused,
    createThread: unused,
    editMessage: unused,
    addReaction: unused,
    leaveGuild: unused,
    getGatewayBot: unused,
    listApplicationCommands: unused,
    overwriteApplicationCommands: unused,
    ...overrides,
  } satisfies DiscordApiClient;
}

function connection(input: Partial<IntegrationConnection<'discord'>> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: WORKSPACE_ID,
    provider: 'discord',
    externalAccountId: GUILD_ID,
    slug: 'discord_acme',
    displayName: 'Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...input,
    repositoryAccessMode: input.repositoryAccessMode ?? 'selected',
  } satisfies IntegrationConnection<'discord'>;
}

interface TestAppOptions {
  discord?: ReturnType<typeof discordClient> | undefined;
  existing?: IntegrationConnection<'discord'> | undefined;
  connectDiscordInstallation?: (
    input: ConnectDiscordInstallationInput,
  ) => Promise<IntegrationConnection<'discord'>>;
}

async function createTestApp(options: TestAppOptions = {}): Promise<FastifyInstance> {
  const provider = createDiscordIntegrationProvider({
    discord: options.discord ?? discordClient(),
    install: {
      getExistingDiscordConnection: vi.fn(() => Promise.resolve(options.existing)),
      connectDiscordInstallation:
        options.connectDiscordInstallation ??
        vi.fn((input: ConnectDiscordInstallationInput) =>
          Promise.resolve(connection({workspaceId: input.workspaceId})),
        ),
      connectionCapabilities: [],
      requireActiveWorkspaceMembership: () => Promise.resolve(),
    },
  });
  const app = await createApp({auth: [fakeUserAuth], routes: provider.routes, swagger: false});
  await app.ready();
  return app;
}

const NONCE = 'browser-nonce-1';
const STATE_COOKIE = 'shipfox_discord_install_state';

/** By default the browser carries the cookie that the matching install request set. */
function callback(
  app: FastifyInstance,
  query: Record<string, string>,
  options: {cookieNonce?: string | null} = {},
) {
  const cookieNonce = options.cookieNonce === undefined ? NONCE : options.cookieNonce;
  return app.inject({
    method: 'GET',
    url: `/integrations/discord/callback/api?${new URLSearchParams(query)}`,
    headers: {
      authorization: 'Bearer user',
      ...(cookieNonce === null ? {} : {cookie: `${STATE_COOKIE}=${cookieNonce}`}),
    },
  });
}

function validState(
  overrides: {workspaceId?: string; userId?: string; nonce?: string} = {},
): string {
  return signDiscordInstallState({
    workspaceId: overrides.workspaceId ?? WORKSPACE_ID,
    userId: overrides.userId ?? 'user-1',
    nonce: overrides.nonce ?? NONCE,
  });
}

async function guildLockHeldElsewhere(guildId: string): Promise<boolean> {
  const session = await openPostgresSession();
  try {
    const result = await session.query<{acquired: boolean}>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [discordGuildLockKey(guildId)],
    );
    return result.rows[0]?.acquired !== true;
  } finally {
    await session.end();
  }
}

describe('Discord install routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  describe('POST /integrations/discord/install', () => {
    it('returns the bot install URL with signed workspace state and no identify scope', async () => {
      const app = await createTestApp();
      authenticatedMemberships = [
        {workspaceId: WORKSPACE_ID, role: 'admin', workspaceStatus: 'active'},
      ];

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/discord/install',
        headers: {authorization: 'Bearer user'},
        payload: {workspace_id: WORKSPACE_ID},
      });

      const installUrl = new URL(res.json().install_url);
      expect(res.statusCode).toBe(200);
      expect(installUrl.origin + installUrl.pathname).toBe('https://discord.com/oauth2/authorize');
      expect(Object.fromEntries(installUrl.searchParams)).toEqual({
        client_id: APPLICATION_ID,
        scope: 'bot applications.commands',
        permissions: DISCORD_BOT_PERMISSIONS,
        integration_type: '0',
        response_type: 'code',
        redirect_uri: 'https://shipfox.example.com/integrations/discord/callback',
        state: expect.any(String),
      });
      const setCookie = String(res.headers['set-cookie']);
      const nonce = setCookie.split(';')[0]?.split('=')[1];
      expect(nonce).toBeTruthy();
      expect(setCookie).toContain(`${STATE_COOKIE}=`);
      expect(setCookie).toContain('Max-Age=1800');
      expect(setCookie).toContain('Path=/integrations/discord');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
      expect(
        verifyDiscordInstallState(installUrl.searchParams.get('state') ?? '', {nonce}),
      ).toEqual({
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
      });
    });

    it('rejects a workspace the actor cannot access', async () => {
      const app = await createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/discord/install',
        headers: {authorization: 'Bearer user'},
        payload: {workspace_id: WORKSPACE_ID},
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /integrations/discord/callback/api', () => {
    it('connects a new server from the guild in the exchange, not the query hint', async () => {
      const discord = discordClient();
      const connectDiscordInstallation = vi.fn((input: ConnectDiscordInstallationInput) =>
        Promise.resolve(connection({workspaceId: input.workspaceId})),
      );
      const app = await createTestApp({discord, connectDiscordInstallation});

      const res = await callback(app, {
        code: 'code-1',
        state: validState(),
        guild_id: 'attacker-guild',
        permissions: '8',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        outcome: 'connected',
        connection: {provider: 'discord', workspace_id: WORKSPACE_ID},
      });
      expect(discord.exchangeAuthorizationCode).toHaveBeenCalledWith({code: 'code-1'});
      expect(discord.getGuild).toHaveBeenCalledWith({guildId: GUILD_ID});
      expect(connectDiscordInstallation).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        guildId: GUILD_ID,
        guildName: 'Acme',
        permissions: '309237730368',
        botRoleId: 'bot-role',
        lifecycleStatus: 'active',
      });
    });

    it('revokes the user token after the exchange', async () => {
      const discord = discordClient();
      const app = await createTestApp({discord});

      await callback(app, {code: 'code-1', state: validState()});

      expect(discord.revokeAccessToken).toHaveBeenCalledWith({accessToken: 'user-token'});
    });

    it('still connects when the token revoke fails', async () => {
      const discord = discordClient({
        revokeAccessToken: vi.fn(() => Promise.reject(providerError('provider-unavailable', 503))),
      });
      const app = await createTestApp({discord});

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe('connected');
    });

    it('reports reconnected when the workspace already holds the server', async () => {
      const app = await createTestApp({existing: connection({lifecycleStatus: 'error'})});

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe('reconnected');
    });

    it('stores null when the guild has no managed role for the bot yet', async () => {
      const connectDiscordInstallation = vi.fn((input: ConnectDiscordInstallationInput) =>
        Promise.resolve(connection({workspaceId: input.workspaceId})),
      );
      const app = await createTestApp({
        discord: discordClient({getGuild: vi.fn(() => Promise.resolve(guild({roles: []})))}),
        connectDiscordInstallation,
      });

      await callback(app, {code: 'code-1', state: validState()});

      expect(connectDiscordInstallation).toHaveBeenCalledWith(
        expect.objectContaining({botRoleId: null, permissions: DISCORD_BOT_PERMISSIONS}),
      );
    });

    it('holds the guild lock from the membership check through the commit', async () => {
      const observed: {step: string; lockHeld: boolean}[] = [];
      const discord = discordClient({
        getGuild: vi.fn(async () => {
          observed.push({step: 'membership', lockHeld: await guildLockHeldElsewhere(GUILD_ID)});
          return guild();
        }),
      });
      const app = await createTestApp({
        discord,
        connectDiscordInstallation: async (input) => {
          observed.push({step: 'commit', lockHeld: await guildLockHeldElsewhere(GUILD_ID)});
          return connection({workspaceId: input.workspaceId});
        },
      });

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(res.statusCode).toBe(200);
      expect(observed).toEqual([
        {step: 'membership', lockHeld: true},
        {step: 'commit', lockHeld: true},
      ]);
      await expect(guildLockHeldElsewhere(GUILD_ID)).resolves.toBe(false);
    });

    it('reports access_denied when the person cancelled', async () => {
      const discord = discordClient();
      const app = await createTestApp({discord});

      const res = await callback(app, {error: 'access_denied', state: validState()});

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({outcome: 'access_denied'});
      expect(discord.exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it('rejects any other OAuth error', async () => {
      const app = await createTestApp();

      const res = await callback(app, {
        error: 'server_error',
        error_description: 'Discord broke',
        state: validState(),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        code: 'discord-oauth-callback-error',
        details: {error: 'server_error', error_description: 'Discord broke'},
      });
    });

    it('rejects a server linked to another workspace with already-linked', async () => {
      const connectDiscordInstallation = vi.fn();
      const app = await createTestApp({
        existing: connection({workspaceId: OTHER_WORKSPACE_ID}),
        connectDiscordInstallation,
      });

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('discord-installation-already-linked');
      expect(connectDiscordInstallation).not.toHaveBeenCalled();
    });

    it.each([
      ['a tampered state', () => `${validState()}x`],
      [
        'an expired state',
        () =>
          signDiscordInstallState({
            workspaceId: WORKSPACE_ID,
            userId: 'user-1',
            nonce: NONCE,
            now: new Date('2020-01-01T00:00:00Z'),
          }),
      ],
      ['a malformed state', () => 'not-a-state'],
    ])('rejects %s with state-invalid before any Discord call', async (_name, makeState) => {
      const discord = discordClient();
      const app = await createTestApp({discord});

      const res = await callback(app, {code: 'code-1', state: makeState()});

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid-discord-install-state');
      expect(discord.exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it.each([
      ['no state cookie', null],
      ['a different state cookie', 'another-browser-nonce'],
    ])('rejects a callback with %s before any Discord call', async (_name, cookieNonce) => {
      const discord = discordClient();
      const app = await createTestApp({discord});

      const res = await callback(app, {code: 'code-1', state: validState()}, {cookieNonce});

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid-discord-install-state');
      expect(discord.exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it('rejects a cancelled callback that lacks the state cookie', async () => {
      const app = await createTestApp();

      const res = await callback(
        app,
        {error: 'access_denied', state: validState()},
        {cookieNonce: null},
      );

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid-discord-install-state');
    });

    it('clears the state cookie so a callback cannot be replayed', async () => {
      const app = await createTestApp();

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(String(res.headers['set-cookie'])).toContain(`${STATE_COOKIE}=;`);
    });

    it('rejects a state started by a different user', async () => {
      const discord = discordClient();
      const app = await createTestApp({discord});

      const res = await callback(app, {
        code: 'code-1',
        state: validState({userId: 'someone-else'}),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('discord-install-state-actor-mismatch');
      expect(discord.exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it.each([
      ['unknown guild', providerError('not-found', 404)],
      ['missing access', providerError('access-denied', 403)],
    ])('reports bot-not-in-guild when the membership check answers %s', async (_name, error) => {
      const connectDiscordInstallation = vi.fn();
      const app = await createTestApp({
        discord: discordClient({getGuild: vi.fn(() => Promise.reject(error))}),
        connectDiscordInstallation,
      });

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('discord-bot-not-in-guild');
      expect(connectDiscordInstallation).not.toHaveBeenCalled();
      await expect(guildLockHeldElsewhere(GUILD_ID)).resolves.toBe(false);
    });

    it('reports bot-not-in-guild when the exchange carries no guild', async () => {
      const discord = discordClient({
        exchangeAuthorizationCode: vi.fn(() =>
          Promise.resolve({accessToken: 'user-token', guild: undefined}),
        ),
      });
      const app = await createTestApp({discord});

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('discord-bot-not-in-guild');
      expect(discord.revokeAccessToken).toHaveBeenCalledWith({accessToken: 'user-token'});
      expect(discord.getGuild).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the code exchange',
        {
          exchangeAuthorizationCode: vi.fn(() =>
            Promise.reject(providerError('provider-unavailable', 503)),
          ),
        },
      ],
      [
        'the membership check',
        {getGuild: vi.fn(() => Promise.reject(providerError('provider-unavailable', 503)))},
      ],
    ])('reports provider-unavailable when %s fails', async (_name, overrides) => {
      const app = await createTestApp({discord: discordClient(overrides)});

      const res = await callback(app, {code: 'code-1', state: validState()});

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('provider-unavailable');
    });
  });
});
