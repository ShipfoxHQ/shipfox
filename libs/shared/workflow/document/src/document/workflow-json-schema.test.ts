import {buildWorkflowJsonSchema} from './workflow-json-schema.js';

type JsonSchema = Record<string, unknown>;

describe('buildWorkflowJsonSchema', () => {
  it('publishes input declarations without the reserved agent key', () => {
    const schema = buildWorkflowJsonSchema();
    const step = stepSchemaFor(schema);
    const output = object(object(object(step.properties).outputs).additionalProperties);

    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://www.shipfox.io/docs/workflow.schema.json',
      title: 'Shipfox Workflow',
    });
    expect(object(step.properties)).not.toHaveProperty('agent');
    expect(output.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({enum: ['string', 'number', 'boolean', 'json']}),
      ]),
    );
  });

  it('restricts thinking values for each harness', () => {
    const schema = buildWorkflowJsonSchema();
    const conditionals = objects(stepSchemaFor(schema).allOf);

    expect(thinkingValuesFor(conditionals, 'pi')).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(thinkingValuesFor(conditionals, 'claude')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(thinkingValuesForMissingHarness(conditionals)).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('describes every JSON Schema property', () => {
    const missingDescriptions = descriptionsMissingFrom(buildWorkflowJsonSchema());

    expect(missingDescriptions).toEqual([]);
  });
});

function stepSchemaFor(schema: JsonSchema): JsonSchema {
  const jobs = object(object(schema.properties).jobs);
  const job = object(jobs.additionalProperties);
  const steps = object(object(job.properties).steps);
  return object(steps.items);
}

function thinkingValuesFor(conditionals: JsonSchema[], harness: string): unknown {
  const conditional = conditionals.find(
    (candidate) => object(object(object(candidate.if).properties).harness).const === harness,
  );
  return object(object(object(conditional?.then).properties).thinking).enum;
}

function thinkingValuesForMissingHarness(conditionals: JsonSchema[]): unknown {
  const conditional = conditionals.find((candidate) =>
    Array.isArray(object(object(candidate.if).not).required),
  );
  return object(object(object(conditional?.then).properties).thinking).enum;
}

function descriptionsMissingFrom(schema: JsonSchema, path = '#'): string[] {
  const missing: string[] = [];
  const properties = object(schema.properties);
  for (const [name, value] of Object.entries(properties)) {
    const property = object(value);
    const propertyPath = `${path}/properties/${name}`;
    if (typeof property.description !== 'string' || property.description.trim() === '') {
      missing.push(`${propertyPath}: add .meta({description: '...'}) to its Zod field.`);
    }
    missing.push(...descriptionsMissingFrom(property, propertyPath));
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties') continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isObject(item))
          missing.push(...descriptionsMissingFrom(item, `${path}/${key}/${index}`));
      });
    } else if (isObject(value)) {
      missing.push(...descriptionsMissingFrom(value, `${path}/${key}`));
    }
  }

  return missing;
}

function object(value: unknown): JsonSchema {
  return isObject(value) ? value : {};
}

function objects(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function isObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
