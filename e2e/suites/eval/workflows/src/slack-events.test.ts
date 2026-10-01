import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import type {EventSenderContext} from './senders.js';
import {createSlackEventSender} from './slack-events.js';

const context: EventSenderContext = {
  workspaceId: 'workspace',
  projectId: 'project',
  connectionId: 'connection',
  token: 'token',
  repository: 'acme/report-cli',
};
const mention = {channel: 'C1', ts: '1.000200', user: 'U1', text: '<@UBOT> where is it?'};
const invalidPayloadPattern = /app_mention payload is invalid/u;
const unknownEventPattern = /cannot send message events/u;

function senderWithPoster() {
  const postMention = vi.fn(() => Promise.resolve('Ev1'));
  return {postMention, send: createSlackEventSender({teamId: 'T1', postMention})};
}

describe('createSlackEventSender', () => {
  it('signs a mention for the case team and returns its event id as the delivery id', async () => {
    const {send, postMention} = senderWithPoster();

    const delivery = await send({event: 'app_mention', payload: mention, context});

    expect(delivery).toEqual({deliveryId: 'Ev1'});
    expect(postMention).toHaveBeenCalledWith({
      teamId: 'T1',
      threadTs: undefined,
      ...mention,
    });
  });

  it('passes the parent message of a mention made inside a thread', async () => {
    const {send, postMention} = senderWithPoster();

    await send({
      event: 'app_mention',
      payload: {...mention, thread_ts: '1.000100'},
      context,
    });

    expect(postMention).toHaveBeenCalledWith({
      teamId: 'T1',
      threadTs: '1.000100',
      ...mention,
    });
  });

  it('rejects a mention without a channel', async () => {
    const {send} = senderWithPoster();

    await expect(
      send({event: 'app_mention', payload: {ts: '1.000200', user: 'U1', text: 'hi'}, context}),
    ).rejects.toThrow(invalidPayloadPattern);
  });

  it('rejects an event the Slack fake cannot send', async () => {
    const {send} = senderWithPoster();

    await expect(send({event: 'message', payload: mention, context})).rejects.toThrow(
      unknownEventPattern,
    );
  });
});
