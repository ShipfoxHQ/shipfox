import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {type CandidateManifest, sha512Integrity} from '../src/candidate-bundle.js';
import {
  type CandidateObjectStore,
  candidatePointerKey,
  type IsAncestor,
  uploadCandidateBundle,
} from '../src/candidate-upload.js';

const olderSha = '1'.repeat(40);
const sha = '2'.repeat(40);
const newerSha = '3'.repeat(40);
const publicUrl = 'https://candidates.example.test';
const prefix = `candidates/${sha}`;
const directories: string[] = [];
const IMMUTABLE_ERROR = /shipfox-api-server-33\.2\.1\.tgz already exists with different content/u;
const MANIFEST_IMMUTABLE_ERROR = /manifest\.json already exists with different content/u;

// Commit order used by these tests: olderSha -> sha -> newerSha.
const isAncestor: IsAncestor = (ancestor, descendant) => Promise.resolve(ancestor < descendant);

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, {force: true, recursive: true});
});

class FakeStore implements CandidateObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly writes: string[] = [];

  get(key: string) {
    return Promise.resolve(this.objects.get(key));
  }

  put(key: string, body: Buffer) {
    this.objects.set(key, body);
    this.writes.push(key);
    return Promise.resolve();
  }

  async putIfAbsent(key: string, body: Buffer) {
    if (this.objects.has(key)) return false;
    await this.put(key, body);
    return true;
  }
}

function writeBundle({
  tarball = 'api-server tarball',
  createdAt = '2026-09-26T12:00:00.000Z',
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'shipfox-candidate-upload-'));
  directories.push(directory);
  const file = 'shipfox-api-server-33.2.1.tgz';
  writeFileSync(join(directory, file), tarball);
  const manifest: CandidateManifest = {
    schemaVersion: 1,
    sha,
    createdAt,
    packages: [
      {
        name: '@shipfox/api-server',
        version: '33.2.1',
        file,
        integrity: sha512Integrity(Buffer.from(tarball)),
      },
    ],
  };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  writeFileSync(join(directory, 'overrides.yaml'), `overrides:\n  "@shipfox/api-server": x\n`);
  return directory;
}

function pointer(store: FakeStore) {
  return JSON.parse(store.objects.get(candidatePointerKey)?.toString('utf8') ?? 'null');
}

describe('uploadCandidateBundle', () => {
  test('uploads tarballs before the manifest, then moves the pointer', async () => {
    const store = new FakeStore();

    const result = await uploadCandidateBundle({
      directory: writeBundle(),
      publicUrl,
      store,
      isAncestor,
    });

    assert.deepEqual(store.writes, [
      `${prefix}/shipfox-api-server-33.2.1.tgz`,
      `${prefix}/overrides.yaml`,
      `${prefix}/manifest.json`,
      candidatePointerKey,
    ]);
    assert.deepEqual(pointer(store), {sha, createdAt: '2026-09-26T12:00:00.000Z'});
    assert.deepEqual(result, {
      sha,
      manifestUrl: `${publicUrl}/${prefix}/manifest.json`,
      pointerAdvanced: true,
    });
  });

  test('succeeds on a rerun that finds the same candidate already uploaded', async () => {
    const store = new FakeStore();
    await uploadCandidateBundle({directory: writeBundle(), publicUrl, store, isAncestor});

    const result = await uploadCandidateBundle({
      directory: writeBundle({createdAt: '2026-09-26T12:05:00.000Z'}),
      publicUrl,
      store,
      isAncestor,
    });

    assert.equal(result.pointerAdvanced, true);
    assert.equal(pointer(store).sha, sha);
  });

  test('fails when an existing tarball has different content', async () => {
    const store = new FakeStore();
    await uploadCandidateBundle({directory: writeBundle(), publicUrl, store, isAncestor});

    const upload = () =>
      uploadCandidateBundle({
        directory: writeBundle({tarball: 'rebuilt differently'}),
        publicUrl,
        store,
        isAncestor,
      });

    await assert.rejects(upload, IMMUTABLE_ERROR);
  });

  test('fails when an existing manifest lists different packages', async () => {
    const store = new FakeStore();
    store.objects.set(
      `${prefix}/manifest.json`,
      Buffer.from(JSON.stringify({schemaVersion: 1, sha, packages: []})),
    );

    const upload = () =>
      uploadCandidateBundle({directory: writeBundle(), publicUrl, store, isAncestor});

    await assert.rejects(upload, MANIFEST_IMMUTABLE_ERROR);
    assert.equal(store.objects.has(candidatePointerKey), false);
  });

  test('moves the pointer forward from an older commit', async () => {
    const store = new FakeStore();
    store.objects.set(candidatePointerKey, Buffer.from(JSON.stringify({sha: olderSha})));

    const result = await uploadCandidateBundle({
      directory: writeBundle(),
      publicUrl,
      store,
      isAncestor,
    });

    assert.equal(result.pointerAdvanced, true);
    assert.equal(pointer(store).sha, sha);
  });

  test('keeps the pointer on a newer commit when an older candidate is rerun', async () => {
    const store = new FakeStore();
    store.objects.set(candidatePointerKey, Buffer.from(JSON.stringify({sha: newerSha})));

    const result = await uploadCandidateBundle({
      directory: writeBundle(),
      publicUrl,
      store,
      isAncestor,
    });

    assert.equal(result.pointerAdvanced, false);
    assert.equal(pointer(store).sha, newerSha);
    assert.ok(store.objects.has(`${prefix}/manifest.json`));
  });
});
