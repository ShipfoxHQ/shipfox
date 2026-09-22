import {z} from 'zod';

export const AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES = 16 * 1024;
export const AGENT_ACCESS_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const utf8Encoder = new TextEncoder();
const safeRefInputPattern = '^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+$';
const workflowRunAttemptSchema = z.number().int().min(1).max(2_147_483_647);
const workflowRunStatusSchema = z.enum([
  'waiting',
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
const uuidSchema = z.string().uuid();
const inputsSchema = z
  .custom<Record<string, unknown>>(isRecord, 'Inputs must be a JSON object')
  .superRefine((inputs, context) => {
    if (Object.hasOwn(inputs, '__proto__')) {
      context.addIssue({code: 'custom', message: 'Inputs must not contain a __proto__ property'});
      return;
    }

    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(inputs);
    } catch {
      context.addIssue({code: 'custom', message: 'Inputs must be JSON serializable'});
      return;
    }
    if (serialized === undefined) {
      context.addIssue({code: 'custom', message: 'Inputs must be JSON serializable'});
      return;
    }
    if (utf8Encoder.encode(serialized).byteLength > AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Inputs must contain at most ${AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES} UTF-8 bytes when serialized`,
      });
    }
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const safeRefSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(isSafeRefInput, 'Ref contains a control character');
const safeConfigPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafeRefInput, 'Config path contains a control character');
const createDevRunWarningSchema = z
  .object({
    code: z.string().max(128),
    message: z.string().max(2048),
    path: z.string().max(512).optional(),
  })
  .strict();

function isSafeRefInput(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029);
  });
}

export const cancelWorkflowRunInputSchema = z
  .object({
    run_id: uuidSchema,
    expected_attempt: workflowRunAttemptSchema,
  })
  .strict();

export type CancelWorkflowRunInputDto = z.infer<typeof cancelWorkflowRunInputSchema>;

export const cancelWorkflowRunResultSchema = z
  .object({
    run_id: uuidSchema,
    workflow_run_attempt: workflowRunAttemptSchema,
    status: z.literal('cancelled'),
  })
  .strict();

export type CancelWorkflowRunResultDto = z.infer<typeof cancelWorkflowRunResultSchema>;

export const rerunWorkflowRunInputSchema = z
  .object({
    run_id: uuidSchema,
    expected_attempt: workflowRunAttemptSchema,
    mode: z.enum(['all', 'failed']),
  })
  .strict();

export type RerunWorkflowRunInputDto = z.infer<typeof rerunWorkflowRunInputSchema>;

export const rerunWorkflowRunResultSchema = z
  .object({
    run_id: uuidSchema,
    workflow_run_attempt: workflowRunAttemptSchema,
    status: workflowRunStatusSchema,
  })
  .strict();

export type RerunWorkflowRunResultDto = z.infer<typeof rerunWorkflowRunResultSchema>;

export const fireManualTriggerInputSchema = z
  .object({
    definition_id: uuidSchema,
    inputs: inputsSchema.optional(),
    idempotency_key: z.string().min(1).max(AGENT_ACCESS_IDEMPOTENCY_KEY_MAX_LENGTH).optional(),
  })
  .strict();

export type FireManualTriggerInputDto = z.infer<typeof fireManualTriggerInputSchema>;

export const fireManualTriggerResultSchema = z
  .object({
    run_id: uuidSchema,
    name: z.string(),
    deduplicated: z.boolean(),
  })
  .strict();

export type FireManualTriggerResultDto = z.infer<typeof fireManualTriggerResultSchema>;

export const createDevRunInputSchema = z
  .object({
    project_id: uuidSchema,
    ref: safeRefSchema.optional(),
    content: z.string().optional(),
    config_path: safeConfigPathSchema,
    trigger: z.string().min(1),
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/u)
      .optional(),
    inputs: inputsSchema.optional(),
    replay_event_id: uuidSchema.optional(),
    dry_run: z.boolean().default(false),
  })
  .superRefine(({content, ref, commit}, context) => {
    if (ref === undefined && content === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ref'],
        message: 'ref is required when content is not supplied',
      });
    }
    if (ref === undefined && commit !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commit'],
        message: 'commit requires ref',
      });
    }
  })
  .strict();

export type CreateDevRunInputDto = z.infer<typeof createDevRunInputSchema>;

const createDevRunResultShape = {
  ref: z.string().optional(),
  commit: z.string(),
  warnings: z.array(createDevRunWarningSchema).max(100).optional(),
} as const;

export const createDevRunResultSchema = z.union([
  z
    .object({
      run_id: uuidSchema,
      ...createDevRunResultShape,
    })
    .strict(),
  z
    .object({
      dry_run: z.literal(true),
      check_passed: z.literal(true),
      event_checked: z.boolean().optional(),
      ...createDevRunResultShape,
    })
    .strict(),
]);

export type CreateDevRunResultDto = z.infer<typeof createDevRunResultSchema>;

const uuidJsonSchema = {type: 'string', format: 'uuid'} as const;
const attemptJsonSchema = {type: 'integer', minimum: 1, maximum: 2_147_483_647} as const;
const statusJsonSchema = {
  type: 'string',
  enum: ['waiting', 'pending', 'running', 'succeeded', 'failed', 'cancelled'],
} as const;
const inputsJsonSchema = {
  type: 'object',
  additionalProperties: true,
  propertyNames: {not: {const: '__proto__'}},
  description: `JSON object serialized to at most ${AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES} UTF-8 bytes.`,
} as const;

export const cancelWorkflowRunInputJsonSchema = {
  type: 'object',
  properties: {run_id: uuidJsonSchema, expected_attempt: attemptJsonSchema},
  required: ['run_id', 'expected_attempt'],
  additionalProperties: false,
} as const;

export const cancelWorkflowRunResultJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuidJsonSchema,
    workflow_run_attempt: attemptJsonSchema,
    status: {type: 'string', enum: ['cancelled']},
  },
  required: ['run_id', 'workflow_run_attempt', 'status'],
  additionalProperties: false,
} as const;

export const rerunWorkflowRunInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuidJsonSchema,
    expected_attempt: attemptJsonSchema,
    mode: {type: 'string', enum: ['all', 'failed']},
  },
  required: ['run_id', 'expected_attempt', 'mode'],
  additionalProperties: false,
} as const;

export const rerunWorkflowRunResultJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuidJsonSchema,
    workflow_run_attempt: attemptJsonSchema,
    status: statusJsonSchema,
  },
  required: ['run_id', 'workflow_run_attempt', 'status'],
  additionalProperties: false,
} as const;

export const fireManualTriggerInputJsonSchema = {
  type: 'object',
  properties: {
    definition_id: uuidJsonSchema,
    inputs: inputsJsonSchema,
    idempotency_key: {
      type: 'string',
      minLength: 1,
      maxLength: AGENT_ACCESS_IDEMPOTENCY_KEY_MAX_LENGTH,
    },
  },
  required: ['definition_id'],
  additionalProperties: false,
} as const;

export const fireManualTriggerResultJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuidJsonSchema,
    name: {type: 'string'},
    deduplicated: {type: 'boolean'},
  },
  required: ['run_id', 'name', 'deduplicated'],
  additionalProperties: false,
} as const;

const createDevRunWarningJsonSchema = {
  type: 'object',
  properties: {
    code: {type: 'string', maxLength: 128},
    message: {type: 'string', maxLength: 2048},
    path: {type: 'string', maxLength: 512},
  },
  required: ['code', 'message'],
  additionalProperties: false,
} as const;

export const createDevRunInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJsonSchema,
    ref: {type: 'string', minLength: 1, maxLength: 256, pattern: safeRefInputPattern},
    content: {type: 'string'},
    config_path: {
      type: 'string',
      minLength: 1,
      maxLength: 1024,
      pattern: safeRefInputPattern,
    },
    trigger: {type: 'string', minLength: 1},
    commit: {type: 'string', pattern: '^[0-9a-f]{40}$'},
    inputs: inputsJsonSchema,
    replay_event_id: uuidJsonSchema,
    dry_run: {type: 'boolean', default: false},
  },
  required: ['project_id', 'config_path', 'trigger'],
  anyOf: [{required: ['ref']}, {required: ['content'], not: {required: ['commit']}}],
  additionalProperties: false,
} as const;

export const createDevRunResultJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuidJsonSchema,
    dry_run: {const: true},
    check_passed: {const: true},
    ref: {type: 'string'},
    commit: {type: 'string'},
    event_checked: {type: 'boolean'},
    warnings: {type: 'array', items: createDevRunWarningJsonSchema, maxItems: 100},
  },
  required: ['commit'],
  oneOf: [
    {
      required: ['run_id'],
      not: {
        anyOf: [
          {required: ['dry_run']},
          {required: ['check_passed']},
          {required: ['event_checked']},
        ],
      },
    },
    {
      required: ['dry_run', 'check_passed'],
      not: {required: ['run_id']},
    },
  ],
  additionalProperties: false,
} as const;
