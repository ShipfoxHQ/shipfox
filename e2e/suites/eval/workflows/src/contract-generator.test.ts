import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {generateContractFiles} from './contract-generator.js';
import {defaultOutputRoot, findContractDrift, writeContractFiles} from './contract-output.js';
import {type ContractFiles, loadContracts} from './contracts.js';

const fixtureRoot = fileURLToPath(new URL('../test/fixtures/contracts/', import.meta.url));
const roundTripPattern = /cases of kind `round-trip` are not generated yet/u;
const effectPattern = /a step `effect` is not generated yet/u;
const markerPattern = /\$marker is not generated yet/u;
const includesPattern = /`expect\.includes` is not generated yet/u;
const duplicateJobPattern = /the job key "get_issue" is used by another case/u;
const fileNamePattern = /the file name must make a job key/u;
const shapeFieldPattern = /the shape field "bad-field" must be letters/u;

async function readExpected(): Promise<Record<string, string>> {
  const directory = join(fixtureRoot, 'expected');
  const names = await readdir(directory);
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(join(directory, name), 'utf8')] as const),
    ),
  );
}

describe('generateContractFiles', () => {
  let casesRoot: string;

  beforeEach(async () => {
    casesRoot = await mkdtemp(join(tmpdir(), 'shipfox-eval-contract-cases-'));
    await cp(join(fixtureRoot, 'cases'), casesRoot, {recursive: true});
  });

  afterEach(async () => {
    await rm(casesRoot, {recursive: true, force: true});
  });

  async function writeCase(path: string, source: string) {
    const target = join(casesRoot, path);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, source);
  }

  function generate(): Promise<ContractFiles> {
    return loadContracts(casesRoot);
  }

  it('generates the provider files and the nightly start file for the fixture cases', async () => {
    const generated = generateContractFiles(await generate());

    expect(Object.fromEntries(generated.map(({name, content}) => [name, content]))).toEqual(
      await readExpected(),
    );
  });

  it('keeps cases that do not run in real mode out of the files', async () => {
    const generated = generateContractFiles(await generate());
    const linear = generated.find(({name}) => name === 'contracts-linear.yaml');

    expect(linear?.content).not.toContain('fake_only');
    expect(generated.map(({name}) => name)).not.toContain('contracts-gitea.yaml');
  });

  it('generates nothing when no case runs in real mode', async () => {
    await rm(join(casesRoot, 'linear'), {recursive: true});
    await rm(join(casesRoot, 'github'), {recursive: true});
    await writeCase(
      'linear/fake-only.yaml',
      'provider: linear\nmodes: [fake]\nsteps:\n  - tool: get_issue\n',
    );

    expect(generateContractFiles(await generate())).toEqual([]);
  });

  it('names a job after its case file', async () => {
    await writeCase(
      'linear/get-issue-comments.yaml',
      'provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue_comments\n',
    );

    const linear = generateContractFiles(await generate()).find(
      ({name}) => name === 'contracts-linear.yaml',
    );

    expect(linear?.content).toContain('  get_issue_comments:\n');
  });

  it('starts a provider file only when the provider has fixtures with a read', async () => {
    const github = generateContractFiles(await generate()).find(
      ({name}) => name === 'contracts-github.yaml',
    );

    expect(github?.content).toContain('  fixtures:\n');
    expect(github?.content).toContain('tool: issue_read.get');
  });

  it('rejects two cases that make the same job key', async () => {
    await writeCase(
      'linear/get_issue.yaml',
      'provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n',
    );

    await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
      duplicateJobPattern,
    );
  });

  it('rejects a file name that is not a job key', async () => {
    await writeCase(
      'linear/Get.Issue.yaml',
      'provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n',
    );

    await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
      fileNamePattern,
    );
  });

  it('rejects a shape field that is not an identifier', async () => {
    await writeCase(
      'linear/bad.yaml',
      'provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    expect:\n      shape: {bad-field: string}\n',
    );

    await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
      shapeFieldPattern,
    );
  });

  it('does not generate round-trip cases, effects, $marker, or includes yet', async () => {
    const base = 'provider: linear\nmodes: [real]\n';
    await writeCase(
      'linear/round.yaml',
      `${base}kind: round-trip\nsteps:\n  - tool: save_issue\n    effect: {tool: get_issue}\n`,
    );
    await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
      roundTripPattern,
    );

    await writeCase(
      'linear/round.yaml',
      `${base}steps:\n  - tool: get_issue\n    effect: {tool: get_issue}\n`,
    );
    await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
      effectPattern,
    );

    await writeCase(
      'linear/round.yaml',
      `${base}steps:\n  - tool: get_issue\n    with: {id: $marker}\n`,
    );
    await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
      markerPattern,
    );

    await writeCase(
      'linear/round.yaml',
      `${base}steps:\n  - tool: get_issue\n    expect:\n      includes: {labels: {name: bug}}\n`,
    );
    await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
      includesPattern,
    );
  });
});

describe('contract drift', () => {
  let outputRoot: string;

  beforeEach(async () => {
    outputRoot = await mkdtemp(join(tmpdir(), 'shipfox-eval-contract-output-'));
  });

  afterEach(async () => {
    await rm(outputRoot, {recursive: true, force: true});
  });

  async function generated() {
    return generateContractFiles(await loadContracts(join(fixtureRoot, 'cases')));
  }

  it('finds no drift after the files are written', async () => {
    await writeContractFiles({generated: await generated(), outputRoot});

    expect(await findContractDrift({generated: await generated(), outputRoot})).toEqual([]);
  });

  it('finds a hand edit of a generated file', async () => {
    await writeContractFiles({generated: await generated(), outputRoot});
    const path = join(outputRoot, 'contracts-linear.yaml');
    await writeFile(path, (await readFile(path, 'utf8')).replace('CON-1', 'CON-2'));

    expect(await findContractDrift({generated: await generated(), outputRoot})).toEqual([
      'contracts-linear.yaml differs from the generated file',
    ]);
  });

  it('finds a case edited without regenerating', async () => {
    await writeContractFiles({generated: await generated(), outputRoot});
    const casesRoot = await mkdtemp(join(tmpdir(), 'shipfox-eval-contract-cases-'));
    try {
      await cp(join(fixtureRoot, 'cases'), casesRoot, {recursive: true});
      const path = join(casesRoot, 'linear', 'get-issue.yaml');
      await writeFile(path, (await readFile(path, 'utf8')).replace('uuid: string', 'name: string'));

      const edited = generateContractFiles(await loadContracts(casesRoot));

      expect(await findContractDrift({generated: edited, outputRoot})).toEqual([
        'contracts-linear.yaml differs from the generated file',
      ]);
    } finally {
      await rm(casesRoot, {recursive: true, force: true});
    }
  });

  it('finds a missing file and a file no case generates', async () => {
    await writeContractFiles({generated: await generated(), outputRoot});
    await rm(join(outputRoot, 'contracts-github.yaml'));
    await writeFile(join(outputRoot, 'contracts-jira.yaml'), 'name: Contracts jira\n');

    expect(await findContractDrift({generated: await generated(), outputRoot})).toEqual([
      'contracts-github.yaml is missing',
      'contracts-jira.yaml is not generated from any case',
    ]);
  });

  it('removes the contract files that no case generates any more', async () => {
    await writeFile(join(outputRoot, 'contracts-jira.yaml'), 'name: Contracts jira\n');
    await writeFile(join(outputRoot, 'other.yaml'), 'name: Other\n');

    await writeContractFiles({generated: await generated(), outputRoot});

    expect((await readdir(outputRoot)).sort()).toEqual([
      'contracts-github.yaml',
      'contracts-linear.yaml',
      'contracts.yaml',
      'other.yaml',
    ]);
  });

  it('matches the committed files in .shipfox-staging/workflows', async () => {
    const files = await loadContracts();

    expect(
      await findContractDrift({
        generated: generateContractFiles(files),
        outputRoot: defaultOutputRoot,
      }),
    ).toEqual([]);
  });
});
