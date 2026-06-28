import {z} from 'zod';
import {agentThinkingSchema} from './step-enums.js';

const stringOrStringArraySchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const nonEmptyRecordSchema = <ValueSchema extends z.ZodType>(valueSchema: ValueSchema) =>
  z
    .record(z.string().min(1), valueSchema)
    .refine((value) => Object.keys(value).length > 0, {message: 'Expected at least one entry'});

// Runner shell steps execute on Unix shells, so workflow env names follow the
// portable POSIX-style variable shape.
const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const envStringValueSchema = z.string().refine((value) => !value.includes('\u0000'), {
  message: 'Env string values cannot contain null bytes',
});
export const workflowDocumentEnvSchema = z.record(
  envNameSchema,
  z.union([envStringValueSchema, z.number(), z.boolean()]),
);

const workflowDocumentTriggerBaseSchema = {
  source: z.string().min(1),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

export const workflowDocumentTriggerSchema = z.strictObject({
  ...workflowDocumentTriggerBaseSchema,
  event: z.string().min(1),
});

const workflowDocumentStepGateSchema = z
  .strictObject({
    success_if: z.string().min(1).optional(),
    on_failure: z
      .strictObject({
        restart_from: z.string().min(1),
        output: z.string().min(1).optional(),
      })
      .optional(),
  })
  .refine((value) => value.success_if !== undefined || value.on_failure !== undefined, {
    message: 'Expected success_if or on_failure',
  });

// A step is a run step (`run`) or an inline agent step (`model` + `prompt`), never
// both. They share one strict object so an unknown key is still rejected; the
// `superRefine` discriminates by which payload keys are present and emits one
// targeted issue per failure mode (a plain union would surface every branch's
// errors at once). The `agent` keyword is declared only so the reserved-keyword
// case produces a clear message instead of a generic "unrecognized key".
export const workflowDocumentStepSchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    thinking: agentThinkingSchema.optional(),
    provider: z.string().min(1).optional(),
    agent: z.unknown().optional(),
    gate: workflowDocumentStepGateSchema.optional(),
    env: workflowDocumentEnvSchema.optional(),
  })
  .superRefine((step, ctx) => {
    if (step.agent !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['agent'],
        message: 'The "agent" keyword is reserved for a future step kind and is not supported yet.',
      });
      return;
    }

    const isRun = step.run !== undefined;
    const isAgent = step.model !== undefined || step.prompt !== undefined;

    if (isRun && isAgent) {
      ctx.addIssue({
        code: 'custom',
        message:
          'A step is either a run step ("run") or an agent step ("model" + "prompt"), not both.',
      });
      return;
    }

    if (!isRun && !isAgent) {
      ctx.addIssue({
        code: 'custom',
        message: 'A step must define either "run" or both "model" and "prompt".',
      });
      return;
    }

    if (isAgent) {
      if (step.env !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['env'],
          message: '"env" is supported only on run steps.',
        });
      }
      if (step.model === undefined) {
        ctx.addIssue({code: 'custom', path: ['model'], message: 'An agent step requires "model".'});
      }
      if (step.prompt === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['prompt'],
          message: 'An agent step requires "prompt".',
        });
      }
      return;
    }

    for (const key of ['model', 'prompt', 'thinking', 'provider'] as const) {
      if (step[key] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `"${key}" is not valid on a run step.`,
        });
      }
    }
  });

export const workflowDocumentJobSchema = z.strictObject({
  needs: stringOrStringArraySchema.optional(),
  runner: stringOrStringArraySchema.optional(),
  env: workflowDocumentEnvSchema.optional(),
  steps: z.array(workflowDocumentStepSchema).min(1),
});

export const workflowDocumentSchema = z.strictObject({
  name: z.string().min(1),
  runner: stringOrStringArraySchema.optional(),
  env: workflowDocumentEnvSchema.optional(),
  triggers: nonEmptyRecordSchema(workflowDocumentTriggerSchema).optional(),
  jobs: nonEmptyRecordSchema(workflowDocumentJobSchema),
});

export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type WorkflowDocumentEnv = z.infer<typeof workflowDocumentEnvSchema>;
export type WorkflowDocumentJob = z.infer<typeof workflowDocumentJobSchema>;
export type WorkflowDocumentRunStepGate = z.infer<typeof workflowDocumentStepGateSchema>;
export type WorkflowDocumentStep = z.infer<typeof workflowDocumentStepSchema>;
export type WorkflowDocumentTrigger = z.infer<typeof workflowDocumentTriggerSchema>;
