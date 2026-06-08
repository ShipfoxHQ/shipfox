import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import {simpleBuildWorkflowConfig} from '#examples/simple-build.js';
import {workflowConfigJsonSchema} from './workflow-config-json-schema.js';

const committedJsonSchemaPath = resolve(import.meta.dirname, 'workflow-config.schema.json');
const committedJsonSchema = JSON.parse(readFileSync(committedJsonSchemaPath, 'utf8')) as unknown;

describe('workflowConfigJsonSchema', () => {
  it('exports a draft 2020-12 JSON Schema object', () => {
    expect(workflowConfigJsonSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.shipfox.dev/workflow-config.schema.json',
      title: 'Shipfox Workflow Config',
      type: 'object',
    });
  });

  it('matches the checked-in language-neutral schema artifact', () => {
    expect(workflowConfigJsonSchema).toEqual(committedJsonSchema);
  });

  it('keeps the generated schema snapshot stable', () => {
    expect(workflowConfigJsonSchema).toMatchSnapshot();
  });

  it('describes required top-level workflow fields', () => {
    expect(workflowConfigJsonSchema.required).toEqual(['name', 'jobs']);
  });

  it('validates a real workflow config with a JSON Schema validator', () => {
    const ajv = new Ajv2020({strict: false});
    const validate = ajv.compile(workflowConfigJsonSchema);

    const result = validate(simpleBuildWorkflowConfig);

    expect(result).toBe(true);
  });

  it('rejects malformed workflow config with a JSON Schema validator', () => {
    const ajv = new Ajv2020({strict: false});
    const validate = ajv.compile(workflowConfigJsonSchema);

    const result = validate({name: 'missing jobs'});

    expect(result).toBe(false);
  });

  it.each([
    ['empty jobs map', {name: 'empty workflow', jobs: {}}],
    [
      'empty triggers map',
      {name: 'simple build', triggers: {}, jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'trigger missing event and on',
      {
        name: 'simple build',
        triggers: {github: {source: 'github'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'trigger with both event and on',
      {
        name: 'simple build',
        triggers: {github: {source: 'github', event: 'push', on: 'pull_request'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'unknown top-level key',
      {name: 'simple build', jobz: {}, jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'unknown step key',
      {name: 'simple build', jobs: {build: {steps: [{run: 'npm test', shell: 'bash'}]}}},
    ],
  ])('rejects %s with a JSON Schema validator', (_label, config) => {
    const ajv = new Ajv2020({strict: false});
    const validate = ajv.compile(workflowConfigJsonSchema);

    const result = validate(config);

    expect(result).toBe(false);
  });
});
