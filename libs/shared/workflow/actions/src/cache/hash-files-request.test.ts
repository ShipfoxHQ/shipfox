import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  parseHashFilesRequest,
  parseHashFilesResponse,
  runHashFilesRequest,
} from '#cache/hash-files-request.js';

const HASH = /^[0-9a-f]{32}$/;

describe('runHashFilesRequest', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'hash-files-request-'));
    writeFileSync(join(cwd, 'lock.txt'), 'v1');
  });

  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
  });

  it('answers the hash and the file count', async () => {
    const response = await runHashFilesRequest({patterns: ['lock.txt'], cwd});

    expect(response).toEqual({ok: true, hash: expect.stringMatching(HASH), files: 1});
  });

  it.each([
    [{patterns: ['missing.txt']}, 'no-match'],
    [{patterns: ['lock.txt'], limits: {maxFiles: 10, maxBytes: 1}}, 'limit'],
    [{patterns: ['~/.npmrc']}, 'invalid'],
  ] as const)('answers a failure the author can fix: %j', async (request, kind) => {
    const response = await runHashFilesRequest({...request, cwd});

    expect(response).toEqual({ok: false, error: {kind, message: expect.any(String)}});
  });
});

describe('parseHashFilesRequest', () => {
  it('rejects a request without patterns', () => {
    expect(() => parseHashFilesRequest({cwd: '/work'})).toThrow(TypeError);
  });
});

describe('parseHashFilesResponse', () => {
  it('reads both answer shapes and rejects anything else', () => {
    expect(parseHashFilesResponse({ok: true, hash: 'a', files: 1})).toEqual({
      ok: true,
      hash: 'a',
      files: 1,
    });
    expect(parseHashFilesResponse({ok: false, error: {kind: 'limit', message: 'm'}})).toEqual({
      ok: false,
      error: {kind: 'limit', message: 'm'},
    });
    expect(() => parseHashFilesResponse({ok: true})).toThrow(TypeError);
  });
});
