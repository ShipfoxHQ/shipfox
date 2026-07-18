import {createHmac} from 'node:crypto';
import {verifySlackSignature} from './signature.js';

const secret = 'test-signing-secret';
const timestamp = '1721300000';
const rawBody = '{"type":"event_callback"}';
const now = Number(timestamp) * 1000;

function signature(body = rawBody): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

describe('verifySlackSignature', () => {
  it('accepts a valid current Slack v0 signature', () => {
    const result = verifySlackSignature({
      signingSecret: secret,
      signature: signature(),
      timestamp,
      rawBody,
      now,
    });

    expect(result).toBe(true);
  });

  it.each([
    ['a tampered body', {rawBody: '{"type":"tampered"}'}],
    ['a missing signature', {signature: undefined}],
    ['an empty signing secret', {signingSecret: ''}],
    ['a missing timestamp', {timestamp: undefined}],
    ['a malformed timestamp', {timestamp: 'not-a-timestamp'}],
    ['a stale timestamp', {now: now + 300_001}],
  ])('rejects %s', (_description, overrides) => {
    const result = verifySlackSignature({
      signingSecret: secret,
      signature: signature(),
      timestamp,
      rawBody,
      now,
      ...overrides,
    });

    expect(result).toBe(false);
  });
});
