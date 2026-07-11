import {z} from 'zod';
import {agentThinkingSchema, harnessSchema} from './step-enums.js';

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
export const workflowDocumentStepOutputTypes = ['string', 'number', 'boolean', 'json'] as const;
export const WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES = WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES;
export const WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES =
  WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES;
export const WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH = 64;

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

const workflowDocumentStepOutputKeyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const workflowDocumentStepOutputTypeSchema = z.enum(workflowDocumentStepOutputTypes);

const workflowDocumentStepOutputDeclarationSchema = z
  .union([
    workflowDocumentStepOutputTypeSchema.transform((type) => ({type})),
    z.strictObject({
      type: workflowDocumentStepOutputTypeSchema,
      schema: z.unknown().optional(),
    }),
  ])
  .superRefine((declaration, ctx) => {
    const schema = 'schema' in declaration ? declaration.schema : undefined;
    if (declaration.type !== 'json' && schema !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: '`schema` is only supported for json outputs.',
      });
      return;
    }

    if (schema === undefined) return;

    if (!isJsonSchemaDocument(schema)) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: 'Schema must be a valid JSON Schema document.',
      });
      return;
    }

    const serializedBytes = utf8Encoder.encode(JSON.stringify(schema)).byteLength;
    if (serializedBytes > WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: `Output JSON Schema cannot serialize to more than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES} bytes.`,
      });
    }

    const depth = maxJsonDepth(schema);
    if (depth > WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: `Output JSON Schema cannot be nested deeper than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH} levels.`,
      });
    }
  });

export const workflowDocumentStepOutputsSchema = z
  .record(z.string(), workflowDocumentStepOutputDeclarationSchema)
  .superRefine((outputs, ctx) => {
    const entries = Object.keys(outputs).length;
    if (entries > WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `Step outputs cannot define more than ${WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES} entries.`,
      });
    }

    for (const key of Object.keys(outputs)) {
      if (workflowDocumentStepOutputKeyPattern.test(key)) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'Output keys must be CEL identifiers.',
      });
    }
  });

const workflowDocumentTriggerBaseSchema = {
  source: z.string().min(1),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
} satisfies z.ZodRawShape;

export const triggerSourceConfigSchemas = {
  cron: z.strictObject({
    schedule: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  }),
} satisfies Record<string, z.ZodType>;
const triggerSourceConfigSchemaRegistry: Readonly<Record<string, z.ZodType>> =
  triggerSourceConfigSchemas;

export const workflowDocumentTriggerSchema = z
  .strictObject({
    ...workflowDocumentTriggerBaseSchema,
    event: z.string().min(1),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.config === undefined) return;

    const configSchema = triggerSourceConfigSchemaRegistry[trigger.source];
    if (configSchema === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['config'],
        message: `\`config\` is not supported for source \`${trigger.source}\`.`,
      });
      return;
    }

    const configResult = configSchema.safeParse(trigger.config);
    if (configResult.success) return;

    for (const configIssue of configResult.error.issues) {
      ctx.addIssue({
        ...configIssue,
        path: ['config', ...configIssue.path],
      });
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
        if (trigger.config !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field, index, 'config'],
            message: '`config` is only supported on top-level triggers.',
          });
        }
      }
    }
  });

const workflowDocumentStepGateSchema = z
  .strictObject({
    success: z.string().min(1).optional(),
    on_failure: z
      .strictObject({
        restart_from: z.string().min(1),
        feedback: z.string().min(1).optional(),
      })
      .optional(),
  })
  .refine((value) => value.success !== undefined || value.on_failure !== undefined, {
    message: 'Expected success or on_failure',
  });

export const workflowDocumentCheckoutSchema = z.strictObject({
  permissions: z
    .strictObject({
      contents: z.enum(['read', 'write']).optional(),
    })
    .optional(),
  'persist-credentials': z.boolean().optional(),
});

export const workflowDocumentStepIntegrationSelectionSchema = z.array(z.string().min(1)).min(1);

export const workflowDocumentStepIntegrationSchema = z.strictObject({
  connection: z.string().min(1).optional(),
  include: workflowDocumentStepIntegrationSelectionSchema,
  exclude: workflowDocumentStepIntegrationSelectionSchema.optional(),
  allow_write: z.boolean().optional(),
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
    if: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    harness: harnessSchema.optional(),
    thinking: agentThinkingSchema.optional(),
    provider: z.string().min(1).optional(),
    tools: z.array(z.string().min(1)).min(1).optional(),
    integrations: z.array(workflowDocumentStepIntegrationSchema).min(1).optional(),
    agent: z.unknown().optional(),
    gate: workflowDocumentStepGateSchema.optional(),
    env: workflowDocumentEnvSchema.optional(),
    outputs: workflowDocumentStepOutputsSchema.optional(),
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
      for (const key of [
        'model',
        'prompt',
        'harness',
        'thinking',
        'provider',
        'tools',
        'integrations',
      ] as const) {
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
      step.harness !== undefined ||
      step.thinking !== undefined ||
      step.provider !== undefined ||
      step.tools !== undefined ||
      step.integrations !== undefined;

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
  if: z.string().min(1).optional(),
  runner: stringOrStringArraySchema.optional(),
  success: z.string().min(1).optional(),
  outputs: nonEmptyRecordSchema(z.string().min(1)).optional(),
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
export type WorkflowDocumentStepIntegration = z.infer<typeof workflowDocumentStepIntegrationSchema>;
export type WorkflowDocumentStepOutputType = (typeof workflowDocumentStepOutputTypes)[number];
export type WorkflowDocumentStepOutputs = z.infer<typeof workflowDocumentStepOutputsSchema>;
export type WorkflowDocumentStep = z.infer<typeof workflowDocumentStepSchema>;
export type WorkflowDocumentTrigger = z.infer<typeof workflowDocumentTriggerSchema>;

function maxJsonDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    return 1 + Math.max(...value.map(maxJsonDepth));
  }

  const entries = Object.values(value);
  if (entries.length === 0) return 1;
  return 1 + Math.max(...entries.map(maxJsonDepth));
}

function isJsonSchemaDocument(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}
