import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workflowTool = resolve(
  packageDirectory,
  '../../../.github/scripts/package-release-workflow.mjs',
);
const authorizedPattern = /authorized=true/;
const createdPattern = /"result":"created"/;
const releasePattern = /revision=release/;
const releasePrPattern = /Release PR: #42/;

describe('package release workflow tool', () => {
  test('authorizes only merged release-App pull requests from the release branch', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-release-workflow-test-'));
    const outputPath = join(temporaryRoot, 'output');

    try {
      await execFileAsync('node', [
        workflowTool,
        'authorize',
        '--event-name',
        'pull_request',
        '--merged',
        'true',
        '--revision',
        'release',
        '--base',
        'base',
        '--head-repository',
        'ShipfoxHQ/shipfox',
        '--head-ref',
        'changeset-release/main',
        '--author-id',
        '123',
        '--repository',
        'ShipfoxHQ/shipfox',
        '--release-app-id',
        '123',
        '--github-output',
        outputPath,
      ]);

      assert.match(await readFile(outputPath, 'utf8'), authorizedPattern);
      assert.match(await readFile(outputPath, 'utf8'), releasePattern);
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });

  test('records whether a release PR was created, updated, or unchanged', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-release-workflow-test-'));
    const beforePath = join(temporaryRoot, 'before.json');
    const afterPath = join(temporaryRoot, 'after.json');
    const summaryPath = join(temporaryRoot, 'summary');
    try {
      await writeFile(beforePath, '[]');
      await writeFile(afterPath, '[{"number": 42, "headRefOid": "head"}]');

      const {stdout} = await execFileAsync('node', [
        workflowTool,
        'summarize-update',
        '--before',
        beforePath,
        '--after',
        afterPath,
        '--trigger',
        'revision',
        '--github-summary',
        summaryPath,
      ]);

      assert.match(stdout, createdPattern);
      assert.match(await readFile(summaryPath, 'utf8'), releasePrPattern);
    } finally {
      await rm(temporaryRoot, {force: true, recursive: true});
    }
  });
});
