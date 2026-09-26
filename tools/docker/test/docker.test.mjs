import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const cacheVariablePattern = /SHIPFOX_DOCKER_CACHE/;
const acceptedCacheValuesPattern = /"gha" or "none"/;
const cliPath = resolve(testDirectory, '../bin/docker.js');

function runDocker(cacheBackend, extraArgs = []) {
  const directory = mkdtempSync(join(tmpdir(), 'shipfox-docker-test-'));
  const dockerPath = join(directory, 'docker');
  const argsPath = join(directory, 'args.json');
  writeFileSync(
    dockerPath,
    '#!/usr/bin/env node\nimport {writeFileSync} from "node:fs";\nwriteFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n',
  );
  chmodSync(dockerPath, 0o755);

  const env = {
    ...process.env,
    ARGS_FILE: argsPath,
    GITHUB_ACTIONS: 'true',
    PATH: `${directory}:${process.env.PATH ?? ''}`,
    npm_package_name: '',
  };
  if (cacheBackend === undefined) delete env.SHIPFOX_DOCKER_CACHE;
  else env.SHIPFOX_DOCKER_CACHE = cacheBackend;

  const result = spawnSync(process.execPath, [cliPath, ...extraArgs], {
    encoding: 'utf8',
    env,
  });
  const args = result.status === 0 ? JSON.parse(readFileSync(argsPath, 'utf8')) : undefined;
  rmSync(directory, {recursive: true, force: true});
  return {...result, args};
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

test('uses the gha cache when SHIPFOX_DOCKER_CACHE is unset', () => {
  const result = runDocker(undefined);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(flagValue(result.args, '--cache-from'), 'type=gha');
  assert.equal(flagValue(result.args, '--cache-to'), 'type=gha,mode=max,ignore-error=true');
});

test('uses the gha cache when SHIPFOX_DOCKER_CACHE is gha', () => {
  const result = runDocker('gha');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(flagValue(result.args, '--cache-from'), 'type=gha');
  assert.equal(flagValue(result.args, '--cache-to'), 'type=gha,mode=max,ignore-error=true');
});

test('does not add cache flags when SHIPFOX_DOCKER_CACHE is none', () => {
  const result = runDocker('none');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.args.includes('--cache-from'), false);
  assert.equal(result.args.includes('--cache-to'), false);
  assert.equal(
    result.args.some((arg) => arg.includes('type=gha')),
    false,
  );
});

test('keeps explicit cache flags ahead of generated defaults', () => {
  const result = runDocker('gha', [
    '--cache-from=type=local,src=/tmp/cache',
    '--cache-to=type=local,dest=/tmp/cache',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.args.includes('--cache-from=type=local,src=/tmp/cache'), true);
  assert.equal(result.args.includes('--cache-to=type=local,dest=/tmp/cache'), true);
  assert.equal(
    result.args.some((arg) => arg.includes('type=gha')),
    false,
  );
});

test('rejects an unsupported SHIPFOX_DOCKER_CACHE value', () => {
  const result = runDocker('registry');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, cacheVariablePattern);
  assert.match(result.stderr, acceptedCacheValuesPattern);
});
