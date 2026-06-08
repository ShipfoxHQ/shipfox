import {z} from 'zod';

const stringOrStringArraySchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

// This package owns the syntactic external config shape. Definitions-layer
// semantic rules, defaults, and internal representations stay in definitions.
export const workflowConfigTriggerSchema = z.object({
  source: z.string().min(1),
  event: z.string().min(1).optional(),
  on: stringOrStringArraySchema.optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().min(1).optional(),
});

export const workflowConfigStepGateOnFailureSchema = z.union([
  z.object({
    restart_from: z.string().min(1),
    output: z.string().min(1).optional(),
  }),
  z.object({
    restart_from: z.string().min(1).optional(),
    output: z.string().min(1),
  }),
]);

export const workflowConfigStepGateSchema = z.union([
  z.object({
    success_if: z.string().min(1),
    on_failure: workflowConfigStepGateOnFailureSchema.optional(),
  }),
  z.object({
    success_if: z.string().min(1).optional(),
    on_failure: workflowConfigStepGateOnFailureSchema,
  }),
]);

export const workflowConfigRunStepSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  run: z.string().min(1),
  gate: workflowConfigStepGateSchema.optional(),
});

export const workflowConfigJobSchema = z.object({
  needs: stringOrStringArraySchema.optional(),
  runner: stringOrStringArraySchema.optional(),
  steps: z.array(workflowConfigRunStepSchema).min(1),
});

export const workflowConfigSchema = z.object({
  name: z.string().min(1),
  runner: stringOrStringArraySchema.optional(),
  triggers: z.record(z.string().min(1), workflowConfigTriggerSchema).optional(),
  jobs: z.record(z.string().min(1), workflowConfigJobSchema),
});

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
export type WorkflowConfigJob = z.infer<typeof workflowConfigJobSchema>;
export type WorkflowConfigRunStep = z.infer<typeof workflowConfigRunStepSchema>;
export type WorkflowConfigStepGate = z.infer<typeof workflowConfigStepGateSchema>;
export type WorkflowConfigStepGateOnFailure = z.infer<typeof workflowConfigStepGateOnFailureSchema>;
export type WorkflowConfigTrigger = z.infer<typeof workflowConfigTriggerSchema>;
