import {buildAppMentionEnvelope} from './slack-events.js';

const base = {
  teamId: 'T1',
  channel: 'C1',
  ts: '1.000200',
  user: 'U1',
  text: '<@Ubot> where is it?',
  eventId: 'Ev1',
};

describe('buildAppMentionEnvelope', () => {
  it('leaves thread_ts out of a top-level mention', () => {
    const envelope = buildAppMentionEnvelope(base);

    expect(envelope.event).not.toHaveProperty('thread_ts');
  });

  it('carries the parent message of a mention made inside a thread', () => {
    const envelope = buildAppMentionEnvelope({...base, threadTs: '1.000100'});

    expect(envelope.event).toMatchObject({channel: 'C1', ts: '1.000200', thread_ts: '1.000100'});
  });
});
