import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {
  actionBundleDigestSchema,
  decodeActionBundle,
  encodeActionBundle,
  InvalidActionBundleError,
} from './action-bundle.js';

const MANIFEST = {path: 'action.yml', content: 'name: Hello\nmain: index.ts\n'};
const ENTRY = {path: 'index.ts', content: 'export default 1;\n'};

function digestOf(json: string): string {
  return `sha256:${createHash('sha256').update(json).digest('hex')}`;
}

describe('action bundle codec', () => {
  it('round trips files in canonical path order', async () => {
    const helper = {path: 'lib/format.ts', content: 'export const x = "é";\n'};

    const bundle = await encodeActionBundle({files: [helper, ENTRY, MANIFEST]});
    const files = await decodeActionBundle({gzip: bundle.gzip, digest: bundle.digest});

    expect(files).toEqual([MANIFEST, ENTRY, helper]);
    expect(bundle.fileCount).toBe(3);
  });

  it('keeps the digest of a known bundle stable', async () => {
    const bundle = await encodeActionBundle({files: [MANIFEST, ENTRY]});

    expect(bundle.digest).toBe(
      'sha256:b555b11c42f774321eb5e3d5378b9a06182bfe2508eb58f23da093b6c3f1b1d8',
    );
    expect(bundle.bytes).toBe(139);
    expect(actionBundleDigestSchema.safeParse(bundle.digest).success).toBe(true);
  });

  it('computes the same digest regardless of input order and path normalization', async () => {
    const decomposed = {path: 'café.ts', content: 'x'};
    const composed = {path: 'café.ts', content: 'x'};

    const first = await encodeActionBundle({files: [MANIFEST, decomposed]});
    const second = await encodeActionBundle({files: [composed, MANIFEST]});

    expect(second.digest).toBe(first.digest);
    await expect(decodeActionBundle(first)).resolves.toContainEqual(composed);
  });

  it('changes the digest when any content changes', async () => {
    const first = await encodeActionBundle({files: [MANIFEST, ENTRY]});
    const second = await encodeActionBundle({
      files: [MANIFEST, {...ENTRY, content: 'export default 2;\n'}],
    });

    expect(second.digest).not.toBe(first.digest);
  });

  it('rejects a bundle whose digest does not match', async () => {
    const bundle = await encodeActionBundle({files: [MANIFEST]});
    const other = await encodeActionBundle({files: [ENTRY]});

    await expect(decodeActionBundle({gzip: bundle.gzip, digest: other.digest})).rejects.toThrow(
      InvalidActionBundleError,
    );
  });

  it('rejects data that is not gzip', async () => {
    await expect(
      decodeActionBundle({gzip: new Uint8Array([1, 2, 3]), digest: digestOf('')}),
    ).rejects.toThrow(InvalidActionBundleError);
  });

  it('rejects a bundle that is not in canonical form', async () => {
    const json = JSON.stringify({version: 1, files: [{path: 'index.ts', content: 'x'}]});

    await expect(
      decodeActionBundle({gzip: gzipSync(json), digest: digestOf(json)}),
    ).rejects.toThrow('canonical form');
  });

  it.each([
    '/etc/passwd',
    '../escape.ts',
    'lib/../index.ts',
    './index.ts',
    'lib//index.ts',
    'lib\\index.ts',
    '',
  ])('rejects the path %j', async (path) => {
    await expect(encodeActionBundle({files: [{path, content: ''}]})).rejects.toThrow(
      InvalidActionBundleError,
    );
  });

  it('rejects paths that collide after normalization', async () => {
    await expect(
      encodeActionBundle({
        files: [
          {path: 'café.ts', content: 'a'},
          {path: 'café.ts', content: 'b'},
        ],
      }),
    ).rejects.toThrow('duplicate path');
  });
});
