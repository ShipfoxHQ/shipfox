import {decodeBase64, encodeBase64} from '#base64.js';
import {REGISTRY_VERSION_PAYLOAD_TYPE} from '#documents.js';
import {
  decodeUnverifiedRegistryVersionEnvelope,
  dssePreAuthenticationEncoding,
  type RegistryEnvelope,
  RegistryEnvelopeError,
  registryEnvelopeSchema,
  signRegistryVersionDocument,
  verifyRegistryVersionEnvelope,
} from '#envelope.js';
import {actionVersionDocument, templateVersionDocument} from '#test/fixtures/documents.js';
import {createTestKey, type TestKey} from '#test/fixtures/keys.js';

const expectedAction = {
  package: 'shipfox/slack-thread-digest',
  version: '1.4.2',
  kind: 'action',
} as const;

let current: TestKey;
let previous: TestKey;

beforeAll(async () => {
  [current, previous] = await Promise.all([
    createTestKey('reg-2026-2'),
    createTestKey('reg-2026-1'),
  ]);
});

function signAction(key: TestKey = current): Promise<RegistryEnvelope> {
  return signRegistryVersionDocument({document: actionVersionDocument(), signer: key.signer});
}

function payloadJson(envelope: RegistryEnvelope): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeBase64(envelope.payload)));
}

function withPayload(envelope: RegistryEnvelope, payload: unknown): RegistryEnvelope {
  return {...envelope, payload: encodeBase64(new TextEncoder().encode(JSON.stringify(payload)))};
}

async function verifyError(
  params: Parameters<typeof verifyRegistryVersionEnvelope>[0],
): Promise<RegistryEnvelopeError> {
  const error = await verifyRegistryVersionEnvelope(params).catch((caught: unknown) => caught);
  if (!(error instanceof RegistryEnvelopeError))
    throw new Error('Expected a RegistryEnvelopeError');
  return error;
}

describe('dssePreAuthenticationEncoding', () => {
  it('matches the DSSE specification example', () => {
    const result = dssePreAuthenticationEncoding({
      payloadType: 'http://example.com/HelloWorld',
      payload: new TextEncoder().encode('hello world'),
    });

    expect(new TextDecoder().decode(result)).toBe(
      'DSSEv1 29 http://example.com/HelloWorld 11 hello world',
    );
  });

  it('counts lengths in bytes, not characters', () => {
    const result = dssePreAuthenticationEncoding({
      payloadType: 't',
      payload: new TextEncoder().encode('é'),
    });

    expect(new TextDecoder().decode(result)).toBe('DSSEv1 1 t 2 é');
  });
});

describe('signRegistryVersionDocument', () => {
  it('writes a DSSE envelope over the canonical JSON of the document', async () => {
    const envelope = await signAction();

    expect(registryEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(envelope.payloadType).toBe(REGISTRY_VERSION_PAYLOAD_TYPE);
    expect(envelope.signatures).toEqual([{keyid: 'reg-2026-2', sig: expect.any(String)}]);
    expect(payloadJson(envelope)).toEqual(actionVersionDocument());
  });

  it('rejects a document that is not a version document', async () => {
    const document = {...actionVersionDocument(), version: '^1.4.2'};

    const result = signRegistryVersionDocument({document, signer: current.signer});

    await expect(result).rejects.toThrow();
  });
});

describe('verifyRegistryVersionEnvelope', () => {
  it('returns the document and the key that signed it', async () => {
    const envelope = await signAction();

    const result = await verifyRegistryVersionEnvelope({
      envelope: JSON.parse(JSON.stringify(envelope)),
      trustedKeys: [current.trustedKey],
      expected: expectedAction,
    });

    expect(result).toEqual({document: actionVersionDocument(), keyid: 'reg-2026-2'});
  });

  it('verifies a template document', async () => {
    const envelope = await signRegistryVersionDocument({
      document: templateVersionDocument(),
      signer: current.signer,
    });

    const result = await verifyRegistryVersionEnvelope({
      envelope,
      trustedKeys: [current.trustedKey],
      expected: {package: 'shipfox/ticket-to-pr', version: '1.0.0', kind: 'template'},
    });

    expect(result.document).toEqual(templateVersionDocument());
  });

  it('rejects a tampered payload', async () => {
    const envelope = await signAction();
    const tampered = withPayload(envelope, {...payloadJson(envelope), license: 'Proprietary'});

    const error = await verifyError({
      envelope: tampered,
      trustedKeys: [current.trustedKey],
      expected: expectedAction,
    });

    expect(error.reason).toBe('signature-invalid');
  });

  it('rejects a changed payload type', async () => {
    const envelope = await signAction();

    const error = await verifyError({
      envelope: {...envelope, payloadType: 'application/json'},
      trustedKeys: [current.trustedKey],
      expected: expectedAction,
    });

    expect(error.reason).toBe('malformed');
  });

  it('rejects a signature from an unknown key', async () => {
    const envelope = await signAction(previous);

    const error = await verifyError({
      envelope,
      trustedKeys: [current.trustedKey],
      expected: expectedAction,
    });

    expect(error.reason).toBe('signature-invalid');
  });

  it('rejects a signature relabeled with a trusted key id', async () => {
    const envelope = await signAction(previous);
    const relabeled = {
      ...envelope,
      signatures: envelope.signatures.map((signature) => ({...signature, keyid: 'reg-2026-2'})),
    };

    const error = await verifyError({
      envelope: relabeled,
      trustedKeys: [current.trustedKey],
      expected: expectedAction,
    });

    expect(error.reason).toBe('signature-invalid');
  });

  it.each([
    ['package', {...expectedAction, package: 'shipfox/other-action'}],
    ['version', {...expectedAction, version: '1.4.1'}],
    ['kind', {...expectedAction, kind: 'template'}],
  ] as const)('rejects a validly signed document of another %s', async (field, expected) => {
    const envelope = await signAction();

    const error = await verifyError({envelope, trustedKeys: [current.trustedKey], expected});

    expect(error.reason).toBe('payload-mismatch');
    expect(error.message).toContain(field);
  });

  it('rejects an unknown schema major once the signature verifies', async () => {
    const document = {...actionVersionDocument(), schema: 'shipfox.registry/version@2'};
    const payload = new TextEncoder().encode(JSON.stringify(document));
    const sig = await current.signer.sign(
      dssePreAuthenticationEncoding({payloadType: REGISTRY_VERSION_PAYLOAD_TYPE, payload}),
    );
    const envelope = {
      payloadType: REGISTRY_VERSION_PAYLOAD_TYPE,
      payload: encodeBase64(payload),
      signatures: [{keyid: current.signer.keyid, sig: encodeBase64(sig)}],
    };

    const error = await verifyError({
      envelope,
      trustedKeys: [current.trustedKey],
      expected: expectedAction,
    });

    expect(error.reason).toBe('schema-unsupported');
  });

  it.each([
    ['a non-object', 'envelope'],
    ['no signatures', {payloadType: REGISTRY_VERSION_PAYLOAD_TYPE, payload: '', signatures: []}],
    [
      'a non-base64 payload',
      {
        payloadType: REGISTRY_VERSION_PAYLOAD_TYPE,
        payload: '%%',
        signatures: [{keyid: 'k', sig: 's'}],
      },
    ],
  ])('rejects %s as malformed', async (_case, envelope) => {
    const error = await verifyError({
      envelope,
      trustedKeys: [current.trustedKey],
      expected: expectedAction,
    });

    expect(error.reason).toBe('malformed');
  });

  describe('key rotation', () => {
    it('keeps versions signed by the previous key valid while it stays trusted', async () => {
      const [before, after] = await Promise.all([signAction(previous), signAction(current)]);
      const trustedKeys = [current.trustedKey, previous.trustedKey];

      const results = await Promise.all(
        [before, after].map((envelope) =>
          verifyRegistryVersionEnvelope({envelope, trustedKeys, expected: expectedAction}),
        ),
      );

      expect(results.map((result) => result.keyid)).toEqual(['reg-2026-1', 'reg-2026-2']);
    });

    it('accepts an envelope when any one signature is trusted', async () => {
      const [byPrevious, byCurrent] = await Promise.all([
        signAction(previous),
        signAction(current),
      ]);
      const envelope = {
        ...byCurrent,
        signatures: [...byPrevious.signatures, ...byCurrent.signatures],
      };

      const result = await verifyRegistryVersionEnvelope({
        envelope,
        trustedKeys: [current.trustedKey],
        expected: expectedAction,
      });

      expect(result.keyid).toBe('reg-2026-2');
    });
  });
});

describe('decodeUnverifiedRegistryVersionEnvelope', () => {
  it('reads the document without trusted keys', async () => {
    const envelope = await signAction();

    const result = decodeUnverifiedRegistryVersionEnvelope(envelope);

    expect(result).toEqual(actionVersionDocument());
  });
});
