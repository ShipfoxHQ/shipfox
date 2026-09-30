import type {DiscordChannel} from '#api/client.js';
import {createDiscordChannelCache} from './channel-cache.js';

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({warn: vi.fn(), info: vi.fn(), error: vi.fn()}),
}));

describe('Discord channel cache', () => {
  it('answers from a remembered channel without calling Discord', async () => {
    const getChannel = vi.fn();
    const cache = createDiscordChannelCache({getChannel});
    cache.remember({id: 'thread-1', type: 11, parent_id: 'channel-1'});

    await expect(cache.resolve('thread-1')).resolves.toEqual({
      isThread: true,
      parentId: 'channel-1',
    });
    expect(getChannel).not.toHaveBeenCalled();
  });

  it('fetches a missing channel once and keeps it', async () => {
    const getChannel = vi.fn(
      async (): Promise<DiscordChannel> => ({id: 'channel-1', type: 0, parent_id: null}),
    );
    const cache = createDiscordChannelCache({getChannel});

    await cache.resolve('channel-1');
    await expect(cache.resolve('channel-1')).resolves.toEqual({isThread: false, parentId: null});

    expect(getChannel).toHaveBeenCalledTimes(1);
    expect(getChannel).toHaveBeenCalledWith({channelId: 'channel-1'});
  });

  it('does not cache a failed lookup, so the next message tries again', async () => {
    const getChannel = vi
      .fn<() => Promise<DiscordChannel>>()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({id: 'channel-1', type: 0});
    const cache = createDiscordChannelCache({getChannel});

    await expect(cache.resolve('channel-1')).resolves.toBeUndefined();
    await expect(cache.resolve('channel-1')).resolves.toEqual({isThread: false, parentId: null});
  });

  it('drops a deleted channel', async () => {
    const getChannel = vi.fn((): Promise<DiscordChannel> => Promise.reject(new Error('gone')));
    const cache = createDiscordChannelCache({getChannel});
    cache.remember({id: 'thread-1', type: 11, parent_id: 'channel-1'});

    cache.forget('thread-1');

    await expect(cache.resolve('thread-1')).resolves.toBeUndefined();
    expect(getChannel).toHaveBeenCalledTimes(1);
  });

  it.each([10, 11, 12])('treats channel type %s as a thread', async (type) => {
    const cache = createDiscordChannelCache({getChannel: vi.fn()});
    cache.remember({id: 'thread-1', type, parent_id: 'channel-1'});

    await expect(cache.resolve('thread-1')).resolves.toMatchObject({isThread: true});
  });

  it('ignores an object that is not a channel', async () => {
    const getChannel = vi.fn((): Promise<DiscordChannel> => Promise.reject(new Error('unknown')));
    const cache = createDiscordChannelCache({getChannel});

    cache.remember({name: 'no id'});
    cache.remember(null);

    await expect(cache.resolve('channel-1')).resolves.toBeUndefined();
  });
});
