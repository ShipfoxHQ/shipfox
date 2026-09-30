import {createPublicKey, generateKeyPairSync, verify} from 'node:crypto';
import {buildSlashCommandInteraction, signDiscordInteraction} from './discord-interactions.js';

describe('Discord interaction signing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs the timestamp and body so the paired public key verifies them', () => {
    const {publicKey, privateKey} = generateKeyPairSync('ed25519');
    vi.stubEnv(
      'E2E_DISCORD_PRIVATE_KEY',
      privateKey.export({format: 'der', type: 'pkcs8'}).toString('base64'),
    );

    const {rawBody, headers} = signDiscordInteraction('{"type":1}', '1700000000');

    expect(headers['x-signature-timestamp']).toBe('1700000000');
    expect(
      verify(
        null,
        Buffer.from(`1700000000${rawBody}`),
        createPublicKey(publicKey.export({format: 'pem', type: 'spki'})),
        Buffer.from(headers['x-signature-ed25519'] as string, 'hex'),
      ),
    ).toBe(true);
  });

  it('signs with a timestamp that is fresh now by default', () => {
    const {privateKey} = generateKeyPairSync('ed25519');
    vi.stubEnv(
      'E2E_DISCORD_PRIVATE_KEY',
      privateKey.export({format: 'der', type: 'pkcs8'}).toString('base64'),
    );

    const {headers} = signDiscordInteraction('{}');

    const timestamp = Number(headers['x-signature-timestamp']);
    expect(Math.abs(timestamp * 1000 - Date.now())).toBeLessThan(5_000);
  });

  it('refuses to sign without a private key', () => {
    vi.stubEnv('E2E_DISCORD_PRIVATE_KEY', '');

    expect(() => signDiscordInteraction('{}')).toThrow('E2E_DISCORD_PRIVATE_KEY');
  });

  it('builds a /shipfox interaction the receiver can route', () => {
    const interaction = buildSlashCommandInteraction({
      guildId: 'guild-1',
      channelId: 'channel-1',
      prompt: 'ship it',
      userId: 'user-1',
      interactionId: 'interaction-1',
    });

    expect(interaction).toMatchObject({
      id: 'interaction-1',
      type: 2,
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      data: {name: 'shipfox', type: 1, options: [{name: 'prompt', value: 'ship it'}]},
    });
  });
});
