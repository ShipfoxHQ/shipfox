import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DefinitionParseError} from './errors.js';
import {parseDefinition} from './parse-definition.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures');

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('parseDefinition', () => {
  test('valid simple workflow returns document and model', () => {
    const yaml = readFixture('valid-simple.yml');

    const definition = parseDefinition(yaml);

    expect(definition.document.name).toBe('Simple build');
    expect(definition.document.triggers?.on_push?.source).toBe('github');
    expect(definition.document.triggers?.on_push?.event).toBe('push');
    expect(definition.document.triggers?.on_demand?.source).toBe('manual');
    expect(definition.document.triggers?.on_demand?.event).toBe('fire');
    expect(definition.document.jobs.build?.steps).toHaveLength(2);
    expect(definition.document.jobs.build?.steps?.[0]?.run).toBe('npm install');
    expect(definition.model.jobs.find((job) => job.id === 'build')?.steps[0]?.command).toEqual({
      kind: 'shell',
      value: 'npm install',
    });
  });

  test('valid DAG workflow parses successfully', () => {
    const yaml = readFixture('valid-dag.yml');

    const definition = parseDefinition(yaml);

    expect(definition.document.name).toBe('Multi-job pipeline');
    expect(Object.keys(definition.document.jobs)).toHaveLength(4);
    expect(definition.model.dependencies).toEqual([
      {from: 'build', to: 'test-unit'},
      {from: 'build', to: 'test-integration'},
      {from: 'test-unit', to: 'deploy'},
      {from: 'test-integration', to: 'deploy'},
    ]);
  });

  test('invalid YAML syntax throws DefinitionParseError', () => {
    const yaml = readFixture('invalid-yaml-syntax.yml');

    expect(() => parseDefinition(yaml)).toThrow(DefinitionParseError);
  });

  test('YAML that parses to a string throws DefinitionParseError', () => {
    expect(() => parseDefinition('just a string')).toThrow(DefinitionParseError);
  });

  test('YAML that parses to null throws DefinitionParseError', () => {
    expect(() => parseDefinition('')).toThrow(DefinitionParseError);
  });

  test('YAML that parses to an array throws DefinitionParseError', () => {
    expect(() => parseDefinition('- item1\n- item2')).toThrow(DefinitionParseError);
  });

  test('valid YAML with invalid document throws DefinitionParseError with details', () => {
    const yaml = readFixture('invalid-missing-name.yml');

    try {
      parseDefinition(yaml);
      expect.fail('Expected DefinitionParseError');
    } catch (error) {
      expect(error).toBeInstanceOf(DefinitionParseError);
      expect((error as DefinitionParseError).details).toBeDefined();
      expect(Array.isArray((error as DefinitionParseError).details)).toBe(true);
    }
  });

  test('valid document with cyclic job dependencies throws DefinitionParseError', () => {
    const yaml = readFixture('invalid-cycle.yml');

    expect(() => parseDefinition(yaml)).toThrow(DefinitionParseError);
  });

  test('manual trigger requires an explicit event', () => {
    const yaml = `name: Manual only
triggers:
  on_demand:
    source: manual
jobs:
  run:
    steps:
      - run: echo hello
`;

    expect(() => parseDefinition(yaml)).toThrow(DefinitionParseError);
  });

  test('declaring more than one manual trigger throws DefinitionParseError', () => {
    const yaml = `name: Multi manual
triggers:
  deploy:
    source: manual
  rollback:
    source: manual
jobs:
  run:
    steps:
      - run: echo hello
`;

    expect(() => parseDefinition(yaml)).toThrow(DefinitionParseError);
  });
});
