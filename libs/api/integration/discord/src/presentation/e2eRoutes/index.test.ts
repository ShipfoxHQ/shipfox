import {closeApp, createApp} from '@shipfox/node-fastify';
import type {DiscordInstallation} from '#db/installations.js';
import {createDiscordE2eRoutes} from './index.js';

const CONNECTION_ID = '00000000-0000-4000-8000-000000000001';

function installation(): DiscordInstallation {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    connectionId: CONNECTION_ID,
    guildId: 'guild-1',
    guildName: 'Acme',
    permissions: '0',
    installedByDiscordUserId: null,
    botRoleId: null,
    status: 'installed',
    generation: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Discord E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  async function arrange(params: {installed?: boolean} = {}) {
    const messageCreate = vi.fn(() => Promise.resolve());
    const app = await createApp({
      routes: [
        createDiscordE2eRoutes({
          getExistingDiscordConnection: vi.fn(() => Promise.resolve(undefined)),
          connectDiscordInstallation: vi.fn(),
          connectionCapabilities: [],
          handlers: {MESSAGE_CREATE: messageCreate},
          getDiscordInstallationByConnectionId: vi.fn(() =>
            Promise.resolve(params.installed === false ? undefined : installation()),
          ),
        }),
      ],
      swagger: false,
    });
    return {app, messageCreate};
  }

  it('runs a dispatch through the handler with the connection guild and session', async () => {
    const {app, messageCreate} = await arrange();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/discord-dispatches',
      payload: {
        connection_id: CONNECTION_ID,
        session_id: 'session-1',
        sequence: 7,
        dispatch: {t: 'MESSAGE_CREATE', d: {id: 'message-1', channel_id: 'channel-1'}},
      },
    });

    expect(res.statusCode).toBe(204);
    expect(messageCreate).toHaveBeenCalledWith(
      {
        op: 0,
        t: 'MESSAGE_CREATE',
        s: 7,
        d: {guild_id: 'guild-1', id: 'message-1', channel_id: 'channel-1'},
      },
      {sessionId: 'session-1'},
    );
  });

  it('sets the guild from the connection even when the payload names another', async () => {
    const {app, messageCreate} = await arrange();

    await app.inject({
      method: 'POST',
      url: '/integrations/discord-dispatches',
      payload: {
        connection_id: CONNECTION_ID,
        dispatch: {t: 'MESSAGE_CREATE', d: {id: 'message-1', guild_id: 'guild-2'}},
      },
    });

    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({d: expect.objectContaining({guild_id: 'guild-1'})}),
      expect.anything(),
    );
  });

  it('rejects a dispatch the Gateway has no handler for', async () => {
    const {app, messageCreate} = await arrange();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/discord-dispatches',
      payload: {connection_id: CONNECTION_ID, dispatch: {t: 'TYPING_START', d: {}}},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({code: 'discord-dispatch-invalid'});
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it('rejects a dispatch for a connection without a Discord installation', async () => {
    const {app, messageCreate} = await arrange({installed: false});

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/discord-dispatches',
      payload: {
        connection_id: CONNECTION_ID,
        dispatch: {t: 'MESSAGE_CREATE', d: {id: 'message-1'}},
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({code: 'discord-connection-not-found'});
    expect(messageCreate).not.toHaveBeenCalled();
  });
});
