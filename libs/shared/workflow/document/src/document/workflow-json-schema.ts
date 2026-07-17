import {z} from 'zod';
import {thinkingLevelsForHarness} from './step-enums.js';
import {workflowDocumentSchema} from './workflow-document.js';

type JsonSchema = Record<string, unknown>;

export interface BuildWorkflowJsonSchemaOptions {
  id?: string;
}

export function buildWorkflowJsonSchema({
  id = 'https://www.shipfox.io/docs/workflow.schema.json',
}: BuildWorkflowJsonSchemaOptions = {}): JsonSchema {
  const schema = z.toJSONSchema(workflowDocumentSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  const stepSchema = stepSchemaFor(schema);
  const stepProperties = propertiesOf(stepSchema);
  const thinkingSchema = object(stepProperties.thinking);

  delete stepProperties.agent;
  const thinkingConditionals = (['pi', 'claude'] as const).map((harness) => {
    const conditional: JsonSchema = {
      if: {
        properties: {
          harness: {
            ...object(stepProperties.harness),
            const: harness,
          },
        },
        required: ['harness'],
      },
    };
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema uses "then" for a conditional branch.
    conditional.then = {
      properties: {
        thinking: {
          ...thinkingSchema,
          enum: [...thinkingLevelsForHarness(harness)],
        },
      },
    };
    return conditional;
  });
  stepSchema.allOf = [
    ...thinkingConditionals,
    thinkingConditionalForMissingHarness(thinkingSchema),
  ];
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  schema.$id = id;
  schema.title = 'Shipfox Workflow';

  return schema;
}

function thinkingConditionalForMissingHarness(thinkingSchema: JsonSchema): JsonSchema {
  const conditional: JsonSchema = {
    if: {not: {required: ['harness']}},
  };
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema uses "then" for a conditional branch.
  conditional.then = {
    properties: {
      thinking: {
        ...thinkingSchema,
        enum: [...thinkingLevelsForHarness('pi')],
      },
    },
  };
  return conditional;
}

function stepSchemaFor(schema: JsonSchema): JsonSchema {
  const jobs = object(propertiesOf(schema).jobs);
  const job = object(jobs.additionalProperties);
  const steps = object(propertiesOf(job).steps);
  return object(steps.items);
}

function propertiesOf(schema: JsonSchema): Record<string, JsonSchema> {
  const properties = object(schema.properties);
  schema.properties = properties;
  return properties as Record<string, JsonSchema>;
}

function object(value: unknown): JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : {};
}
