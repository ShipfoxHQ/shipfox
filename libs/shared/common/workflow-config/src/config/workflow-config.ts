import {z} from 'zod';

const stringOrStringArraySchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const nonEmptyRecordSchema = <ValueSchema extends z.ZodType>(valueSchema: ValueSchema) =>
  z
    .record(z.string().min(1), valueSchema)
    .refine((value) => Object.keys(value).length > 0, {message: 'Expected at least one entry'});

// This package owns the syntactic external config shape. Definitions-layer
// semantic rules, defaults, and internal representations stay in definitions.
const workflowConfigTriggerBaseSchema = {
  source: z.string().min(1),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

export const workflowConfigTriggerSchema = z.union([
  z.strictObject({
    ...workflowConfigTriggerBaseSchema,
    event: z.string().min(1),
    on: z.never().optional(),
  }),
  z.strictObject({
    ...workflowConfigTriggerBaseSchema,
    on: stringOrStringArraySchema,
    event: z.never().optional(),
  }),
]);

export const workflowConfigRunStepSchema = z.strictObject({
  name: z.string().min(1).optional(),
  run: z.string().min(1),
});

export const workflowConfigJobSchema = z.strictObject({
  needs: stringOrStringArraySchema.optional(),
  runner: stringOrStringArraySchema.optional(),
  steps: z.array(workflowConfigRunStepSchema).min(1),
});

export const workflowConfigSchema = z.strictObject({
  name: z.string().min(1),
  runner: stringOrStringArraySchema.optional(),
  triggers: nonEmptyRecordSchema(workflowConfigTriggerSchema).optional(),
  jobs: nonEmptyRecordSchema(workflowConfigJobSchema),
});

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
export type WorkflowConfigJob = z.infer<typeof workflowConfigJobSchema>;
export type WorkflowConfigRunStep = z.infer<typeof workflowConfigRunStepSchema>;
export type WorkflowConfigTrigger = z.infer<typeof workflowConfigTriggerSchema>;
