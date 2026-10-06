import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {createDiscordEventSender} from './discord-events.js';
import type {EventSenderContext} from './senders.js';

const context: EventSenderContext = {
  workspaceId: 'workspace',
  projectId: 'project',
  connectionId: 'github-connection',
  token: 'token',
  repository: 'acme/report-cli',
};
const message = {channel_id: '100', id: '200', user: '300', content: '<@1> where is it?'};
const invalidPayloadPattern = /message_create payload is invalid/u;
const unknownEventPattern = /cannot send message_update events/u;

function senderWithInjector() {
  const injectMessage = vi.fn(() => Promise.resolve());
  return {
    injectMessage,
    send: createDiscordEventSender({connectionId: 'discord-connection', injectMessage}),
  };
}

describe('createDiscordEventSender', () => {
  it('injects the message for the Discord connection and returns its id as the delivery id', async () => {
    const {send, injectMessage} = senderWithInjector();

    const delivery = await send({event: 'message_create', payload: message, context});

    expect(delivery).toEqual({deliveryId: '200'});
    expect(injectMessage).toHaveBeenCalledWith({
      connectionId: 'discord-connection',
      channelId: '100',
      messageId: '200',
      authorId: '300',
      content: '<@1> where is it?',
    });
  });

  it('rejects a payload with an unknown field', async () => {
    const {send, injectMessage} = senderWithInjector();

    await expect(
      send({event: 'message_create', payload: {...message, thread_ts: '1'}, context}),
    ).rejects.toThrow(invalidPayloadPattern);
    expect(injectMessage).not.toHaveBeenCalled();
  });

  it('rejects an event it cannot send', async () => {
    const {send} = senderWithInjector();

    await expect(send({event: 'message_update', payload: message, context})).rejects.toThrow(
      unknownEventPattern,
    );
  });
});
