import {
  surfaceSchemaReference,
  surfaceValidationRuleReference,
} from './surface-schema-reference.js';
import {
  surfaceJobSchema,
  surfaceRunStepSchema,
  surfaceTriggerInputSchema,
  surfaceWorkflowDocumentSchema,
} from './surface-workflow-document.js';

type OptionalAwareSchemaShape = Record<string, {isOptional: () => boolean}>;

const schemaReferences = [
  ['SurfaceWorkflowDocument', surfaceWorkflowDocumentSchema.shape as OptionalAwareSchemaShape],
  ['SurfaceTrigger', surfaceTriggerInputSchema.shape as OptionalAwareSchemaShape],
  ['SurfaceJob', surfaceJobSchema.shape as OptionalAwareSchemaShape],
  ['SurfaceRunStep', surfaceRunStepSchema.shape as OptionalAwareSchemaShape],
] as const;

describe('surfaceSchemaReference', () => {
  test.each(schemaReferences)('documents every %s schema field', (typeName, schemaShape) => {
    const reference = surfaceSchemaReference.find((candidate) => candidate.typeName === typeName);
    const schemaFields = Object.keys(schemaShape);

    expect(reference?.fields.map((field) => field.name).sort()).toEqual([...schemaFields].sort());

    for (const field of reference?.fields ?? []) {
      const schemaField = schemaShape[field.name];

      expect(schemaField?.isOptional()).toBe(field.presence === 'optional');
    }
  });

  test('documents each surface field once', () => {
    for (const reference of surfaceSchemaReference) {
      const fieldNames = reference.fields.map((field) => field.name);

      expect(new Set(fieldNames).size).toBe(fieldNames.length);
    }
  });
});

describe('surfaceValidationRuleReference', () => {
  test('documents PR1 surface validation rules', () => {
    const ruleIds = surfaceValidationRuleReference.map((rule) => rule.id);

    expect(ruleIds).toEqual([
      'surface-root-object',
      'surface-name-required',
      'surface-jobs-map',
      'surface-job-steps-required',
      'surface-trigger-event-required',
      'surface-single-manual-trigger',
      'surface-yaml-syntax',
    ]);
  });
});
