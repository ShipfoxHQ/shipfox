import {z} from 'zod';

export const AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES = 16 * 1024;
export const AGENT_ACCESS_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const utf8Encoder = new TextEncoder();
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
const inputsSchema = z.record(z.string(), z.unknown()).superRefine((inputs, context) => {
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
    ref: safeRefSchema,
    config_path: safeConfigPathSchema,
    trigger: z.string().min(1),
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/u)
      .optional(),
    inputs: inputsSchema.optional(),
    replay_event_id: uuidSchema.optional(),
  })
  .strict();

export type CreateDevRunInputDto = z.infer<typeof createDevRunInputSchema>;

export const createDevRunResultSchema = z
  .object({
    run_id: uuidSchema,
    commit: z.string(),
  })
  .strict();

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

export const createDevRunInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJsonSchema,
    ref: {type: 'string', minLength: 1, maxLength: 256},
    config_path: {type: 'string', minLength: 1, maxLength: 1024},
    trigger: {type: 'string', minLength: 1},
    commit: {type: 'string', pattern: '^[0-9a-f]{40}$'},
    inputs: inputsJsonSchema,
    replay_event_id: uuidJsonSchema,
  },
  required: ['project_id', 'ref', 'config_path', 'trigger'],
  additionalProperties: false,
} as const;

export const createDevRunResultJsonSchema = {
  type: 'object',
  properties: {run_id: uuidJsonSchema, commit: {type: 'string'}},
  required: ['run_id', 'commit'],
  additionalProperties: false,
} as const;
