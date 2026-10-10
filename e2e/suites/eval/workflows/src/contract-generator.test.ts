import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {generateContractFiles} from './contract-generator.js';
import {defaultOutputRoot, findContractDrift, writeContractFiles} from './contract-output.js';
import {type ContractFiles, loadContracts} from './contracts.js';

const fixtureRoot = fileURLToPath(new URL('../test/fixtures/contracts/', import.meta.url));
const effectPattern = /a step `effect` is only for cases of kind `round-trip`/u;
const effectKeyPattern = /the effect key "a_effect" is used by another step/u;
const withOnlyPattern = /is only for `with`, not `expect`/u;
const targetPattern =
  /\$target\.linear\.missing_issue\.identifier is only for cases of kind `error`/u;
const fixtureReadPattern = /is not available in a fixture read/u;
const missingErrorPattern = /a case of kind `error` needs a step with `expect.error`/u;
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

  it('generates the fake files from the fake cases only, without the real-only jobs', async () => {
    const generated = generateContractFiles(await generate(), {mode: 'fake'});

    // Only Linear has a fake case, and nothing starts the provider files in fake mode.
    expect(generated.map(({name}) => name)).toEqual(['contracts-linear.yaml']);
    const linear = generated[0]?.content ?? '';
    expect(linear).toContain('  get_issue:\n');
    expect(linear).toContain('  get_issue_not_found:\n');
    expect(linear).toContain('  fake_only:\n');
    expect(linear).not.toContain('list_teams');
    expect(linear).not.toContain('  fixtures:\n');
  });

  it('generates nothing in fake mode when no case runs against a fake', async () => {
    await rm(join(casesRoot, 'linear'), {recursive: true});

    expect(generateContractFiles(await generate(), {mode: 'fake'})).toEqual([]);
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

  it('gates an error case on the failed status and the error code', async () => {
    const linear = generateContractFiles(await generate()).find(
      ({name}) => name === 'contracts-linear.yaml',
    );

    expect(linear?.content).toContain('id: CON-999999');
    expect(linear?.content).toContain(
      'success: step.status == "failed" && step.error.code == "not-found"',
    );
  });

  it('never reads a target in the fixtures job', async () => {
    const linear = generateContractFiles(await generate()).find(
      ({name}) => name === 'contracts-linear.yaml',
    );
    const fixtures = linear?.content.split('\n  get_issue:')[0] ?? '';

    expect(fixtures).toContain('  fixtures:\n');
    expect(fixtures).not.toContain('CON-999999');
  });

  it('rejects a $target in a read case at load', async () => {
    await writeCase(
      'linear/read-target.yaml',
      'provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    with: {id: $target.linear.missing_issue.identifier}\n',
    );

    await expect(generate()).rejects.toThrow(targetPattern);
  });

  it('rejects a $target in a fixture read at load', async () => {
    const path = join(casesRoot, 'sandbox.yaml');
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace(
        'with: {id: $fixture.linear.issue.identifier}',
        'with: {id: $target.linear.missing_issue.identifier}',
      ),
    );

    await expect(generate()).rejects.toThrow(fixtureReadPattern);
  });

  it('rejects an error case without a step that expects an error', async () => {
    await writeCase(
      'linear/no-error.yaml',
      'provider: linear\nkind: error\nmodes: [real]\nsteps:\n  - tool: get_issue\n',
    );

    await expect(generate()).rejects.toThrow(missingErrorPattern);
  });

  describe('round-trip cases', () => {
    const roundTrip = (steps: string) =>
      `provider: linear\nkind: round-trip\nmodes: [real]\nsteps:\n${steps}`;

    async function generatedLinear(): Promise<string> {
      const files = generateContractFiles(await generate());
      return files.find(({name}) => name === 'contracts-linear.yaml')?.content ?? '';
    }

    it('puts each effect in its own step right after its write', async () => {
      const content = await generatedLinear();

      const order = [...content.matchAll(/- key: ((?:create|close)(?:_effect)?)\n/gu)].map(
        ([, key]) => key,
      );
      expect(order).toEqual(['create', 'create_effect', 'close', 'close_effect']);
    });

    it('maps a $steps reference to an output of the step it reads', async () => {
      const content = await generatedLinear();

      expect(content).toContain(`ref_id: '\${{ has(result.id) ? result.id : "" }}'`);
      expect(content).toContain(`id: \${{ steps.create.outputs.ref_id }}`);
    });

    it('compiles $marker to the run id in `with`', async () => {
      expect(await generatedLinear()).toContain(`title: Contract contract-\${{ run.id }}`);
    });

    it('compiles $in_one_hour to a number an hour after the run was created', async () => {
      await writeCase(
        'linear/in-one-hour.yaml',
        `provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    with: {at: $in_one_hour}\n`,
      );

      expect(await generatedLinear()).toContain('at: ${{ int(run.created_at) + 3600 }}');
    });

    it('compiles expect.includes to exists() over the list', async () => {
      expect(await generatedLinear()).toContain(
        `includes_labels: \${{ has(result.labels) && type(result.labels) == type([]) && result.labels.exists(item, has(item.name) && type(item.name) == type("") && item.name == "contract") }}`,
      );
    });

    it('checks every field of an included item, and keeps scopes apart in nested paths', async () => {
      await writeCase(
        'linear/nested.yaml',
        `provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    expect:\n      includes:\n        teams[0].labels: {name: bug, 'tags[0].id': 3}\n`,
      );

      const content = (await generatedLinear())
        .split('\n')
        .find((line) => line.includes('includes_teams_0_labels:'));

      expect(content).toContain(
        '[result.teams[0]].all(i0, has(i0.labels) && type(i0.labels) == type([]) && i0.labels.exists(item, has(item.name) && type(item.name) == type("") && item.name == "bug" && ',
      );
      expect(content).toContain('[item.tags[0]].all(i1, has(i1.id)');
    });

    it('compiles expect.matches to matches() over a text value', async () => {
      await writeCase(
        'linear/matches.yaml',
        `provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    expect:\n      matches:\n        title: '^Contract'\n`,
      );

      expect(await generatedLinear()).toContain(
        `matches_title: \${{ has(result.title) && type(result.title) == type("") && result.title.matches("^Contract") }}`,
      );
    });

    it('compiles expect.text to matches() over a text result', async () => {
      await writeCase(
        'linear/text.yaml',
        `provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    expect:\n      text:\n        - '^Contract'\n        - 'bug$'\n`,
      );

      const content = await generatedLinear();

      expect(content).toContain(
        `text_0: \${{ type(result) == type("") && result.matches("^Contract") }}`,
      );
      expect(content).toContain(
        `text_1: \${{ type(result) == type("") && result.matches("bug$") }}`,
      );
    });

    it('quotes a date-like string so the server does not read it as a date', async () => {
      await writeCase(
        'linear/date.yaml',
        `provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    with:\n      since: '2026-09-01'\n`,
      );

      expect(await generatedLinear()).toContain('since: "2026-09-01"');
    });

    it('generates round-trip cases in fake mode', async () => {
      await writeCase(
        'linear/fake-trip.yaml',
        (await readFile(join(casesRoot, 'linear', 'issue-round-trip.yaml'), 'utf8')).replace(
          '[real]',
          '[real, fake]',
        ),
      );

      const files = generateContractFiles(await generate(), {mode: 'fake'});

      expect(files.find(({name}) => name === 'contracts-linear.yaml')?.content).toContain(
        'fake_trip:',
      );
    });

    it('rejects an effect outside a round-trip case', async () => {
      await writeCase(
        'linear/read-effect.yaml',
        'provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    effect: {tool: get_issue}\n',
      );

      await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
        effectPattern,
      );
    });

    it('rejects an effect key that another step uses', async () => {
      await writeCase(
        'linear/clash.yaml',
        roundTrip(
          '  - {key: a, tool: save_issue, effect: {tool: get_issue, with: {id: $steps.a.id}}}\n  - {key: a_effect, tool: get_issue}\n',
        ),
      );

      await expect(async () => generateContractFiles(await generate())).rejects.toThrow(
        effectKeyPattern,
      );
    });

    it('rejects $marker and $steps in expect, where a gate cannot read them', async () => {
      await writeCase(
        'linear/marker-expect.yaml',
        roundTrip(
          '  - tool: save_issue\n    effect:\n      tool: get_issue\n      expect:\n        values: {title: $marker}\n',
        ),
      );
      await expect(generate()).rejects.toThrow(withOnlyPattern);

      await writeCase(
        'linear/marker-expect.yaml',
        roundTrip(
          '  - key: a\n    tool: save_issue\n  - tool: get_issue\n    expect:\n      values: {id: $steps.a.id}\n',
        ),
      );
      await expect(generate()).rejects.toThrow(withOnlyPattern);
    });
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
