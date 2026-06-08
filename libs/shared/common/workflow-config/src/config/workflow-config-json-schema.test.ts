import {Ajv2020} from 'ajv/dist/2020.js';
import {simpleBuildWorkflowConfig} from '#examples/simple-build.js';
import {workflowConfigJsonSchema} from './workflow-config-json-schema.js';

describe('workflowConfigJsonSchema', () => {
  it('exports a draft 2020-12 JSON Schema object', () => {
    expect(workflowConfigJsonSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Shipfox Workflow Config',
      type: 'object',
    });
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
});
