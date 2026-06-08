import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseWorkflowYaml} from './parse-workflow-yaml.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures');

async function readFixture(path: string): Promise<string> {
  return await readFile(join(fixtureDir, path), 'utf8');
}

describe('parseWorkflowYaml', () => {
  it('parses valid workflow YAML into a workflow document', async () => {
    const source = await readFixture('valid/simple-build.yaml');
    const expected = JSON.parse(await readFixture('valid/simple-build.document.json')) as unknown;

    const result = parseWorkflowYaml(source);

    expect(result).toEqual({valid: true, document: expected, diagnostics: []});
  });

  it('reports YAML syntax diagnostics', async () => {
    const source = await readFixture('invalid/invalid-yaml-syntax.yaml');

    const result = parseWorkflowYaml(source);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'WFY001',
      severity: 'error',
      path: [],
      details: {line: 7, column: 1},
    });
    expect(result.diagnostics[0]?.message).toContain('Invalid YAML syntax:');
  });

  it.each([
    ['array root', '- npm test'],
    ['scalar root', '42'],
    ['empty input', ''],
  ])('reports non-object YAML documents for %s', (_name, source) => {
    const result = parseWorkflowYaml(source);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFY002',
          severity: 'error',
          message: 'workflow YAML must parse to an object.',
          path: [],
        },
      ],
    });
  });

  it('preserves delegated diagnostic details', () => {
    const result = parseWorkflowYaml(`
name: unsupported trigger field
triggers:
  main:
    source: github
    on: push
jobs:
  build:
    steps:
      - run: npm test
`);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics).toEqual([
      {
        code: 'WFD101',
        severity: 'error',
        message: 'Trigger field "on" is not supported; use "event".',
        path: ['triggers', 'main', 'on'],
        details: {field: 'on'},
      },
    ]);
  });

  it('delegates workflow document diagnostics', async () => {
    const source = await readFixture('invalid/missing-step-run.yaml');

    const result = parseWorkflowYaml(source);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics).toEqual([
      {
        code: 'WFD301',
        severity: 'error',
        message: 'jobs.build.steps[0].run is required.',
        path: ['jobs', 'build', 'steps', 0, 'run'],
      },
    ]);
  });
});
