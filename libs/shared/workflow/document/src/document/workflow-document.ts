import {z} from 'zod';

const stringOrStringArraySchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const nonEmptyRecordSchema = <ValueSchema extends z.ZodType>(valueSchema: ValueSchema) =>
  z
    .record(z.string().min(1), valueSchema)
    .refine((value) => Object.keys(value).length > 0, {message: 'Expected at least one entry'});

// This package owns the syntactic external document shape. Definitions-layer
// semantic rules, defaults, and internal representations stay in definitions.
const workflowDocumentTriggerBaseSchema = {
  source: z.string().min(1),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

export const workflowDocumentTriggerSchema = z.strictObject({
  ...workflowDocumentTriggerBaseSchema,
  event: z.string().min(1),
});

export const workflowDocumentRunStepSchema = z.strictObject({
  name: z.string().min(1).optional(),
  run: z.string().min(1),
});

export const workflowDocumentJobSchema = z.strictObject({
  needs: stringOrStringArraySchema.optional(),
  runner: stringOrStringArraySchema.optional(),
  steps: z.array(workflowDocumentRunStepSchema).min(1),
});

export const workflowDocumentSchema = z.strictObject({
  name: z.string().min(1),
  runner: stringOrStringArraySchema.optional(),
  triggers: nonEmptyRecordSchema(workflowDocumentTriggerSchema).optional(),
  jobs: nonEmptyRecordSchema(workflowDocumentJobSchema),
});

export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type WorkflowDocumentJob = z.infer<typeof workflowDocumentJobSchema>;
export type WorkflowDocumentRunStep = z.infer<typeof workflowDocumentRunStepSchema>;
export type WorkflowDocumentTrigger = z.infer<typeof workflowDocumentTriggerSchema>;
