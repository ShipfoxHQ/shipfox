import {cp, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parseEvalArgs} from './cli.js';
import {bindConnectionSlugs} from './compile.js';
import {
  boundProviders,
  type ContractWorkflowFile,
  listContractWorkflows,
  runContractsCompile,
} from './contracts-compile.js';
import type {CaseResult} from './results.js';

const fixtures = fileURLToPath(new URL('../test/fixtures/contracts/', import.meta.url));
const contractsOnlyPattern = /--suite contracts runs with --mode compile only/u;
const unknownModePattern = /--mode must be scripted, live, or compile/u;
const noFilesPattern = /No contract workflow files matching "contracts-missing.yaml"/u;
const catalogPattern = /--catalog applies to --suite templates --mode compile only/u;

function result(file: ContractWorkflowFile, error?: string): CaseResult {
  return {
    case: file.id,
    mode: 'compile',
    repeat: 1,
    status: error === undefined ? 'passed' : 'error',
    duration_ms: 1,
    cost_usd: 0,
    ...(error === undefined ? {} : {error}),
  };
}

describe('contract workflow files', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-eval-contracts-compile-'));
    await cp(join(fixtures, 'expected'), root, {recursive: true});
  });

  afterEach(async () => {
    await rm(root, {recursive: true});
  });

  it('lists every workflow file by the path the staging project syncs it from', async () => {
    await writeFile(join(root, 'notes.md'), 'Not a workflow');

    const files = await listContractWorkflows({directory: root});

    expect(files.map(({id}) => id)).toEqual([
      '.shipfox-staging/workflows/contracts-github.yaml',
      '.shipfox-staging/workflows/contracts-linear.yaml',
      '.shipfox-staging/workflows/contracts.yaml',
    ]);
  });

  it('filters by path', async () => {
    const files = await listContractWorkflows({directory: root, filter: 'contracts-linear.yaml'});

    expect(files.map(({id}) => id)).toEqual(['.shipfox-staging/workflows/contracts-linear.yaml']);
  });

  it('finds no files in a directory that does not exist', async () => {
    expect(await listContractWorkflows({directory: join(root, 'missing')})).toEqual([]);
  });

  it('writes one result per file and keeps going after a failure, naming the failing path', async () => {
    const compiled: string[] = [];

    const run = await runContractsCompile({
      workflowsDirectory: root,
      resultsDirectory: join(root, 'results'),
      runId: 'contracts-compile',
      compile: (file) => {
        compiled.push(file.id);
        const unknown = file.id.endsWith('contracts-github.yaml');
        return Promise.resolve(
          result(
            file,
            unknown ? 'Error diagnostic unknown-integration-tool at jobs.x: nope' : undefined,
          ),
        );
      },
    });

    expect(run.results.map(({case: id, status}) => [id, status])).toEqual([
      ['.shipfox-staging/workflows/contracts-github.yaml', 'error'],
      ['.shipfox-staging/workflows/contracts-linear.yaml', 'passed'],
      ['.shipfox-staging/workflows/contracts.yaml', 'passed'],
    ]);
  });

  it('fails when the filter matches no file, so a typo cannot pass', async () => {
    await expect(
      runContractsCompile({
        workflowsDirectory: root,
        caseFilter: 'contracts-missing.yaml',
        compile: () => Promise.reject(),
      }),
    ).rejects.toThrow(noFilesPattern);
  });

  it('passes when no workflow file is generated yet', async () => {
    const run = await runContractsCompile({
      workflowsDirectory: join(root, 'missing'),
      resultsDirectory: join(root, 'results'),
      runId: 'contracts-compile',
    });

    expect(run.results).toEqual([]);
  });
});

describe('sandbox connections', () => {
  it('binds each sandbox connection the file marks to the connection created for its provider', async () => {
    const [file] = await listContractWorkflows({
      directory: join(fixtures, 'expected'),
      filter: 'contracts-linear.yaml',
    });
    if (file === undefined) throw new Error('The linear fixture is missing');

    const bound = bindConnectionSlugs({yaml: file.yaml, slugs: {linear: 'linear_acme'}});

    expect(boundProviders(file.yaml)).toEqual(['linear']);
    expect(bound).toContain('connection: linear_acme # bind:linear');
    expect(bound).not.toContain('linear_sandbox');
  });

  it('binds nothing in a file without markers', () => {
    expect(boundProviders('- connection: shipfox\n- connection: jira_sandbox\n')).toEqual([]);
  });
});

describe('contracts suite options', () => {
  it('parses the contracts suite in compile mode', () => {
    expect(parseEvalArgs(['--suite', 'contracts', '--mode', 'compile'])).toMatchObject({
      suite: 'contracts',
      mode: 'compile',
    });
  });

  it('runs the contracts suite in compile mode unless told otherwise', () => {
    expect(parseEvalArgs(['--suite', 'contracts'])).toMatchObject({
      suite: 'contracts',
      mode: 'compile',
    });
  });

  it('rejects the template modes for the contracts suite, and fake mode for every suite', () => {
    expect(() => parseEvalArgs(['--suite', 'contracts', '--mode', 'scripted'])).toThrow(
      contractsOnlyPattern,
    );
    expect(() => parseEvalArgs(['--suite', 'contracts', '--mode', 'fake'])).toThrow(
      unknownModePattern,
    );
  });

  it('rejects a catalog', () => {
    expect(() =>
      parseEvalArgs(['--suite', 'contracts', '--mode', 'compile', '--catalog', 'fixtures']),
    ).toThrow(catalogPattern);
  });
});
