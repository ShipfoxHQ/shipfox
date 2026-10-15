import {dirname} from 'node:path';
import {PassThrough} from 'node:stream';
import {HASH_FILES_CLI_PATH} from '@shipfox/actions/runtime-files';
import type {StepBindingDto} from '@shipfox/api-workflows-dto';
import {
  type ExecutionHost,
  type HostProcess,
  NODE_MOUNT,
  RUNNER_MOUNT,
  type SpawnRequest,
} from '@shipfox/runner-container';
import {
  computeStepHashes,
  hashFilesKey,
  hashFilesLogLines,
  StepHashFilesError,
} from '#core/step-hash-files.js';

const bindings: StepBindingDto[] = [
  {
    target: 'KEY',
    segments: [
      {kind: 'literal', value: 'npm-'},
      {kind: 'hash_files', patterns: ['package-lock.json']},
    ],
  },
  {target: 'AGAIN', segments: [{kind: 'hash_files', patterns: ['package-lock.json']}]},
];

function fakeHost(answer: string, exitCode = 0): {host: ExecutionHost; requests: SpawnRequest[]} {
  const requests: SpawnRequest[] = [];
  const host = {
    spawn: (request: SpawnRequest): HostProcess => {
      requests.push(request);
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      stdout.end(answer);
      stderr.end();
      const exit = Promise.resolve({exitCode, signal: null});
      return {
        stdout,
        stderr,
        stdin,
        exited: exit,
        processExited: exit,
        killTree: () => Promise.resolve(),
      };
    },
  } as unknown as ExecutionHost;
  return {host, requests};
}

describe('computeStepHashes', () => {
  it('hashes inside the job container with the mounted Node and CLI, once per pattern list', async () => {
    const {host, requests} = fakeHost(JSON.stringify({ok: true, hash: 'a'.repeat(32), files: 1}));
    const runnerInstallDir = dirname(dirname(HASH_FILES_CLI_PATH));

    const values = await computeStepHashes({
      bindings,
      cwd: '/work/app',
      container: {host, runnerInstallDir},
      signal: new AbortController().signal,
    });

    expect(requests).toEqual([
      expect.objectContaining({
        argv: [NODE_MOUNT, `${RUNNER_MOUNT}/dist/hash-files-cli.js`],
        cwd: '/work/app',
      }),
    ]);
    expect(values.get(hashFilesKey(['package-lock.json']))).toEqual({
      patterns: ['package-lock.json'],
      hash: 'a'.repeat(32),
      files: 1,
    });
  });

  it('names the patterns and the directory when the container finds no file', async () => {
    const {host} = fakeHost(
      JSON.stringify({ok: false, error: {kind: 'no-match', message: 'hashFiles matched no files'}}),
    );

    const computing = computeStepHashes({
      bindings,
      cwd: '/work/app',
      container: {host, runnerInstallDir: dirname(dirname(HASH_FILES_CLI_PATH))},
      signal: new AbortController().signal,
    });

    await expect(computing).rejects.toThrow(
      new StepHashFilesError(
        "hashFiles('package-lock.json') matched no files in /work/app. A key built from nothing would be shared by every run.",
      ),
    );
  });

  it('reuses a seeded value instead of hashing again', async () => {
    const {host, requests} = fakeHost('unused');
    const seeded = {patterns: ['package-lock.json'], hash: 'b'.repeat(32), files: 2};

    const values = await computeStepHashes({
      bindings,
      cwd: '/work/app',
      container: {host, runnerInstallDir: dirname(dirname(HASH_FILES_CLI_PATH))},
      seed: new Map([[hashFilesKey(['package-lock.json']), seeded]]),
      signal: new AbortController().signal,
    });

    expect(requests).toEqual([]);
    expect([...values.values()]).toEqual([seeded]);
  });
});

describe('hashFilesLogLines', () => {
  it('prints one unmasked line per call with the file count', () => {
    const lines = hashFilesLogLines(
      new Map([
        ['a', {patterns: ['package-lock.json'], hash: 'a'.repeat(32), files: 1}],
        [
          'b',
          {
            patterns: ['**/package-lock.json', 'pnpm-workspace.yaml'],
            hash: 'c'.repeat(32),
            files: 14,
          },
        ],
      ]),
    );

    expect(lines).toEqual([
      `hashFiles(package-lock.json) = ${'a'.repeat(32)} (1 file)`,
      `hashFiles(**/package-lock.json, pnpm-workspace.yaml) = ${'c'.repeat(32)} (14 files)`,
    ]);
  });
});
