import {createDiscordSigner} from '#test/index.js';
import {isDiscordTimestampFresh, verifyDiscordSignature} from './signature.js';

describe('verifyDiscordSignature', () => {
  const signer = createDiscordSigner();
  const rawBody = '{"type":1}';
  const timestamp = '1721300000';
  const signature = signer.signBody({rawBody, timestamp});
  const verify = (overrides: Partial<Parameters<typeof verifyDiscordSignature>[0]> = {}) =>
    verifyDiscordSignature({
      publicKey: signer.publicKey,
      signature,
      timestamp,
      rawBody: Buffer.from(rawBody),
      ...overrides,
    });

  it('accepts a signature over the timestamp and raw body', () => {
    expect(verify()).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verify({rawBody: Buffer.from('{"type":2}')})).toBe(false);
  });

  it('rejects a different timestamp', () => {
    expect(verify({timestamp: '1721300001'})).toBe(false);
  });

  it('rejects a signature from another key', () => {
    expect(verify({publicKey: createDiscordSigner().publicKey})).toBe(false);
  });

  it.each([
    ['a non-hex signature', {signature: 'z'.repeat(128)}],
    ['a short signature', {signature: 'ab'}],
    ['a non-hex public key', {publicKey: 'discord-public-key'}],
    ['a short public key', {publicKey: 'ab'.repeat(16)}],
  ])('rejects %s without throwing', (_name, overrides) => {
    expect(verify(overrides)).toBe(false);
  });
});

describe('isDiscordTimestampFresh', () => {
  const receivedAt = 1_721_300_000_000;

  it.each([
    ['at receipt', '1721300000', true],
    ['300 s before receipt', '1721299700', true],
    ['300 s after receipt', '1721300300', true],
    ['301 s before receipt', '1721299699', false],
    ['301 s after receipt', '1721300301', false],
    ['not a number', 'yesterday', false],
    ['negative', '-1721300000', false],
    ['fractional', '1721300000.5', false],
  ])('%s', (_name, timestamp, expected) => {
    expect(isDiscordTimestampFresh(timestamp, receivedAt)).toBe(expected);
  });
});
