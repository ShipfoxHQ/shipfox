import {createHmac} from 'node:crypto';
import {verifySentrySignature} from './signature.js';

const SECRET = 'test-client-secret';

function sign(rawBody: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('verifySentrySignature', () => {
  test('accepts a signature computed with the matching secret', () => {
    const rawBody = JSON.stringify({action: 'created'});

    const result = verifySentrySignature({rawBody, signature: sign(rawBody), secret: SECRET});

    expect(result).toBe(true);
  });

  test('rejects a signature for a tampered body', () => {
    const rawBody = JSON.stringify({action: 'created'});

    const result = verifySentrySignature({
      rawBody,
      signature: sign(`${rawBody}tampered`),
      secret: SECRET,
    });

    expect(result).toBe(false);
  });

  test('rejects a signature computed with a different secret', () => {
    const rawBody = JSON.stringify({action: 'created'});

    const result = verifySentrySignature({
      rawBody,
      signature: sign(rawBody, 'other-secret'),
      secret: SECRET,
    });

    expect(result).toBe(false);
  });

  test('rejects a garbage signature whose length differs from the digest without throwing', () => {
    const rawBody = JSON.stringify({action: 'created'});

    const result = verifySentrySignature({rawBody, signature: 'deadbeef', secret: SECRET});

    expect(result).toBe(false);
  });
});
