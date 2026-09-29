import {discordConnectionExternalUrl} from './connection-url.js';

describe('Discord connectionExternalUrl', () => {
  it('links to the Discord guild', () => {
    expect(discordConnectionExternalUrl('123456789')).toBe(
      'https://discord.com/channels/123456789',
    );
  });
});
