import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {runEval} from './cli.js';
import {discoverCases} from './discovery.js';

const temporaryDirectories: string[] = [];
const invalidCasePattern = /scenario/iu;
const liveModePattern = /live mode/iu;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true})),
  );
});

describe('template case discovery', () => {
  it('discovers and validates the fixture case', async () => {
    const cases = await discoverCases(
      fileURLToPath(new URL('../cases/templates/', import.meta.url)),
    );

    const fixture = cases.find((entry) => entry.id === 'fixture');
    expect(fixture?.definition.bindings).toEqual({source: 'github'});
  });

  it('reports the field that makes an invalid case unreadable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-invalid-'));
    temporaryDirectories.push(root);
    const caseDirectory = join(root, 'broken');
    await mkdir(caseDirectory);
    await writeFile(join(caseDirectory, 'case.yaml'), 'template: shipfox/fixture\nexpect: {}\n');

    await expect(discoverCases(root)).rejects.toThrow(invalidCasePattern);
  });
});

describe('eval results', () => {
  it('writes one result per repeat and a summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-results-'));
    temporaryDirectories.push(root);
    const resultsDirectory = join(root, 'results');

    const run = await runEval({
      suite: 'templates',
      mode: 'scripted',
      repeat: 2,
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      caseFilter: 'fixture',
      resultsDirectory,
      runId: 'proof',
    });

    expect(run.results).toHaveLength(2);
    expect((await readdir(join(resultsDirectory, 'proof', 'fixture'))).sort()).toEqual([
      '1.json',
      '2.json',
    ]);
    expect(await readdir(join(resultsDirectory, 'proof'))).toContain('summary.md');
  });

  it('rejects live mode until cases execute', async () => {
    await expect(
      runEval({
        suite: 'templates',
        mode: 'live',
        repeat: 1,
        cwd: fileURLToPath(new URL('../', import.meta.url)),
      }),
    ).rejects.toThrow(liveModePattern);
  });
});
