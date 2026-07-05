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
export const WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES = 128;
export const WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES = 32 * 1024;

const utf8Encoder = new TextEncoder();

export const workflowDocumentEnvSchema = z
  .record(envNameSchema, z.union([envStringValueSchema, z.number(), z.boolean()]))
  .superRefine((env, ctx) => {
    const entries = Object.keys(env).length;
    if (entries > WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `Env cannot define more than ${WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES} entries.`,
      });
    }

    const serializedBytes = utf8Encoder.encode(JSON.stringify(env)).byteLength;
    if (serializedBytes > WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `Env cannot serialize to more than ${WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES} bytes.`,
      });
    }
  });

const workflowDocumentTriggerBaseSchema = {
  source: z.string().min(1),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().min(1).optional(),
  schedule: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
} satisfies z.ZodRawShape;
const topLevelCronTriggerFields = ['schedule', 'timezone'] as const;

export const workflowDocumentTriggerSchema = z
  .strictObject({
    ...workflowDocumentTriggerBaseSchema,
    event: z.string().min(1),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.source === 'cron') return;

    for (const field of topLevelCronTriggerFields) {
      if (trigger[field] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `\`${field}\` is only allowed on a cron trigger (source: cron).`,
        });
      }
    }
  });

const workflowDocumentListeningSchema = z
  .strictObject({
    on: z.array(workflowDocumentTriggerSchema).min(1),
    until: z.array(workflowDocumentTriggerSchema).min(1).optional(),
    timeout: z.string().min(1).optional(),
    max_executions: z.number().int().positive().optional(),
    batch: z
      .strictObject({
        debounce: z.string().min(1).optional(),
        max_size: z.number().int().positive().optional(),
        max_wait: z.string().min(1).optional(),
      })
      .refine(
        (value) =>
          value.debounce !== undefined ||
          value.max_size !== undefined ||
          value.max_wait !== undefined,
        {message: 'Expected debounce, max_size, or max_wait'},
      )
      .optional(),
    on_resolve: z.enum(['finish', 'cancel']).optional(),
  })
  .superRefine((listening, ctx) => {
    for (const field of ['on', 'until'] as const) {
      for (const [index, trigger] of (listening[field] ?? []).entries()) {
        for (const triggerField of topLevelCronTriggerFields) {
          if (trigger.source === 'cron' && trigger[triggerField] !== undefined) {
            ctx.addIssue({
              code: 'custom',
              path: [field, index, triggerField],
              message: `\`${triggerField}\` is only supported on top-level cron triggers.`,
            });
          }
        }
      }
    }
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

export const workflowDocumentCheckoutSchema = z.strictObject({
  permissions: z
    .strictObject({
      contents: z.enum(['read', 'write']).optional(),
    })
    .optional(),
  'persist-credentials': z.boolean().optional(),
});

// A step is a run step (`run`) or an inline agent step (`prompt`), never
// both. They share one strict object so an unknown key is still rejected; the
// `superRefine` discriminates by which payload keys are present and emits one
// targeted issue per failure mode (a plain union would surface every branch's
// errors at once). The `agent` keyword is declared only so the reserved-keyword
// case produces a clear message instead of a generic "unrecognized key".
export const workflowDocumentStepSchema = z
  .strictObject({
    key: z.string().min(1).optional(),
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

    if (step.run !== undefined) {
      for (const key of ['model', 'prompt', 'thinking', 'provider'] as const) {
        if (step[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `"${key}" is not valid on a run step.`,
          });
        }
      }
      return;
    }

    const isAgent =
      step.model !== undefined ||
      step.prompt !== undefined ||
      step.thinking !== undefined ||
      step.provider !== undefined;

    if (!isAgent) {
      ctx.addIssue({
        code: 'custom',
        message: 'A step must define either "run" or an agent "prompt".',
      });
      return;
    }

    if (step.env !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['env'],
        message: '"env" is supported only on run steps.',
      });
    }
    if (step.prompt === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['prompt'],
        message: 'An agent step requires "prompt".',
      });
    }
  });

export const workflowDocumentJobSchema = z.strictObject({
  needs: stringOrStringArraySchema.optional(),
  runner: stringOrStringArraySchema.optional(),
  success: z.string().min(1).optional(),
  execution_timeout: z.string().min(1).optional(),
  checkout: workflowDocumentCheckoutSchema.optional(),
  listening: workflowDocumentListeningSchema.optional(),
  name: z.string().min(1).optional(),
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
export type WorkflowDocumentJobCheckout = z.infer<typeof workflowDocumentCheckoutSchema>;
export type WorkflowDocumentEnv = z.infer<typeof workflowDocumentEnvSchema>;
export type WorkflowDocumentJob = z.infer<typeof workflowDocumentJobSchema>;
export type WorkflowDocumentJobListening = z.infer<typeof workflowDocumentListeningSchema>;
export type WorkflowDocumentRunStepGate = z.infer<typeof workflowDocumentStepGateSchema>;
export type WorkflowDocumentStep = z.infer<typeof workflowDocumentStepSchema>;
export type WorkflowDocumentTrigger = z.infer<typeof workflowDocumentTriggerSchema>;
