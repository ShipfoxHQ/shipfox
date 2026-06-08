import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import {simpleBuildWorkflowDocument} from '#examples/simple-build.js';
import {workflowDocumentJsonSchema} from './workflow-document-json-schema.js';

const committedJsonSchemaPath = resolve(import.meta.dirname, 'workflow-document.schema.json');
const committedJsonSchema = JSON.parse(readFileSync(committedJsonSchemaPath, 'utf8')) as unknown;

describe('workflowDocumentJsonSchema', () => {
  it('exports a draft 2020-12 JSON Schema object', () => {
    expect(workflowDocumentJsonSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.shipfox.dev/workflow-document.schema.json',
      title: 'Shipfox Workflow Document',
      type: 'object',
    });
  });

  it('matches the checked-in language-neutral schema artifact', () => {
    expect(workflowDocumentJsonSchema).toEqual(committedJsonSchema);
  });

  it('keeps the generated schema snapshot stable', () => {
    expect(workflowDocumentJsonSchema).toMatchSnapshot();
  });

  it('describes required top-level workflow fields', () => {
    expect(workflowDocumentJsonSchema.required).toEqual(['name', 'jobs']);
  });

  it('validates a real workflow document with a JSON Schema validator', () => {
    const ajv = new Ajv2020({strict: false});
    const validate = ajv.compile(workflowDocumentJsonSchema);

    const result = validate(simpleBuildWorkflowDocument);

    expect(result).toBe(true);
  });

  it('rejects malformed workflow document with a JSON Schema validator', () => {
    const ajv = new Ajv2020({strict: false});
    const validate = ajv.compile(workflowDocumentJsonSchema);

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
      'trigger missing event',
      {
        name: 'simple build',
        triggers: {github: {source: 'github'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'trigger with unsupported on',
      {
        name: 'simple build',
        triggers: {github: {source: 'github', on: 'push'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'trigger with unsupported on and event',
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
  ])('rejects %s with a JSON Schema validator', (_label, workflowDocument) => {
    const ajv = new Ajv2020({strict: false});
    const validate = ajv.compile(workflowDocumentJsonSchema);

    const result = validate(workflowDocument);

    expect(result).toBe(false);
  });
});
