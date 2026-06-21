import {createHmac} from 'node:crypto';
import {verifyHexHmacSignature} from './webhook-signature.js';

const SECRET = 'test-webhook-secret';

function sign(rawBody: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('verifyHexHmacSignature', () => {
  test('accepts a signature computed with the matching secret', () => {
    const rawBody = JSON.stringify({ref: 'refs/heads/main'});

    const result = verifyHexHmacSignature({rawBody, signature: sign(rawBody), secret: SECRET});

    expect(result).toBe(true);
  });

  test('rejects a signature for a tampered body', () => {
    const rawBody = JSON.stringify({ref: 'refs/heads/main'});

    const result = verifyHexHmacSignature({
      rawBody,
      signature: sign(`${rawBody}tampered`),
      secret: SECRET,
    });

    expect(result).toBe(false);
  });

  test('rejects a signature computed with a different secret', () => {
    const rawBody = JSON.stringify({ref: 'refs/heads/main'});

    const result = verifyHexHmacSignature({
      rawBody,
      signature: sign(rawBody, 'other-secret'),
      secret: SECRET,
    });

    expect(result).toBe(false);
  });

  test('rejects a garbage signature whose length differs from the digest without throwing', () => {
    const rawBody = JSON.stringify({ref: 'refs/heads/main'});

    const result = verifyHexHmacSignature({rawBody, signature: 'deadbeef', secret: SECRET});

    expect(result).toBe(false);
  });
});
