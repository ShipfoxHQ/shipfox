import {actionUploadsSchema, MAX_LOCAL_UPLOAD_BYTES} from '@shipfox/api-definitions-dto';
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
    run_url: z.string().url().optional(),
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
    run_url: z.string().url().optional(),
  })
  .strict();

export type FireManualTriggerResultDto = z.infer<typeof fireManualTriggerResultSchema>;

export const createDevRunInputSchema = z
  .object({
    project_id: uuidSchema,
    ref: safeRefSchema.optional(),
    content: z.string().optional(),
    actions: actionUploadsSchema.optional(),
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
      run_url: z.string().url().optional(),
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
    run_url: {type: 'string', format: 'uri'},
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
    run_url: {type: 'string', format: 'uri'},
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

const actionUploadFileJsonSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      description: 'Path relative to the action directory, for example lib/graph.ts.',
    },
    content: {type: 'string', description: 'UTF-8 text of the file.'},
  },
  required: ['path', 'content'],
  additionalProperties: false,
} as const;

const actionUploadJsonSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      pattern: '^\\./',
      description:
        'The uses path exactly as the workflow writes it, for example ./.shipfox/actions/notify.',
    },
    files: {type: 'array', items: actionUploadFileJsonSchema, minItems: 1},
  },
  required: ['path', 'files'],
  additionalProperties: false,
} as const;

export const createDevRunInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJsonSchema,
    ref: {type: 'string', minLength: 1, maxLength: 256, pattern: safeRefInputPattern},
    content: {type: 'string'},
    actions: {
      type: 'array',
      items: actionUploadJsonSchema,
      description: `Whole action directories, each replacing the ref's copy of its path. content and every action file share ${MAX_LOCAL_UPLOAD_BYTES} UTF-8 bytes.`,
    },
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
    run_url: {type: 'string', format: 'uri'},
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
      not: {anyOf: [{required: ['run_id']}, {required: ['run_url']}]},
    },
  ],
  additionalProperties: false,
} as const;

/** At most this many journaled events are checked in one `check_workflow` call. */
export const AGENT_ACCESS_CHECK_WORKFLOW_MAX_EVENT_IDS = 50;

export const checkWorkflowInputSchema = z
  .object({
    project_id: uuidSchema,
    ref: safeRefSchema.optional(),
    content: z.string().optional(),
    actions: actionUploadsSchema.optional(),
    config_path: safeConfigPathSchema,
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/u)
      .optional(),
    trigger: z.string().min(1).optional(),
    event_ids: z
      .array(uuidSchema)
      .min(1)
      .max(AGENT_ACCESS_CHECK_WORKFLOW_MAX_EVENT_IDS)
      .refine((ids) => new Set(ids).size === ids.length, 'event_ids must be unique')
      .optional(),
  })
  .superRefine(({content, ref, commit, trigger, event_ids}, context) => {
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
    if (event_ids !== undefined && trigger === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['event_ids'],
        message: 'event_ids requires trigger',
      });
    }
  })
  .strict();

export type CheckWorkflowInputDto = z.infer<typeof checkWorkflowInputSchema>;

const checkWorkflowEventResultSchema = z.enum([
  'matched',
  'filtered',
  'filter-error',
  'event-mismatch',
  'payload-unavailable',
  'not-found',
]);

const checkWorkflowDiagnosticSchema = z
  .object({
    code: z.string().max(128),
    path: z.string().max(512).optional(),
    index: z.number().int().optional(),
    offset: z.number().int().nonnegative().optional(),
    classification: z.string().max(64).optional(),
    actual_type: z.string().max(32).optional(),
  })
  .strict();

export const checkWorkflowResultSchema = z
  .object({
    valid: z.boolean(),
    ref: z.string().optional(),
    commit: z.string(),
    errors: z.array(
      z
        .object({
          message: z.string(),
          path: z.string().optional(),
          reason: z.string().optional(),
        })
        .strict(),
    ),
    errors_total: z.number().int().nonnegative(),
    errors_truncated: z.boolean(),
    warnings: z.array(createDevRunWarningSchema),
    warnings_truncated: z.boolean(),
    triggers: z.array(
      z
        .object({
          key: z.string(),
          source: z.string(),
          event: z.string().optional(),
          filter: z.string().optional(),
        })
        .strict(),
    ),
    events: z
      .array(
        z
          .object({
            event_id: uuidSchema,
            result: checkWorkflowEventResultSchema,
            source: z.string().optional(),
            event: z.string().optional(),
            received_at: z.string().datetime().optional(),
            reason: z.string().optional(),
            diagnostic: checkWorkflowDiagnosticSchema.optional(),
          })
          .strict(),
      )
      .max(AGENT_ACCESS_CHECK_WORKFLOW_MAX_EVENT_IDS)
      .optional(),
    event_counts: z
      .object({
        matched: z.number().int().nonnegative(),
        filtered: z.number().int().nonnegative(),
        filter_error: z.number().int().nonnegative(),
        event_mismatch: z.number().int().nonnegative(),
        payload_unavailable: z.number().int().nonnegative(),
        not_found: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CheckWorkflowResultDto = z.infer<typeof checkWorkflowResultSchema>;

export const checkWorkflowInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJsonSchema,
    ref: {type: 'string', minLength: 1, maxLength: 256, pattern: safeRefInputPattern},
    content: {
      type: 'string',
      description: 'The complete workflow YAML, for a file not pushed yet.',
    },
    actions: {
      type: 'array',
      items: actionUploadJsonSchema,
      description: `Whole action directories, each replacing the ref's copy of its path. content and every action file share ${MAX_LOCAL_UPLOAD_BYTES} UTF-8 bytes.`,
    },
    config_path: {
      type: 'string',
      minLength: 1,
      maxLength: 1024,
      pattern: safeRefInputPattern,
    },
    commit: {type: 'string', pattern: '^[0-9a-f]{40}$'},
    trigger: {
      type: 'string',
      minLength: 1,
      description:
        'Trigger key in the workflow file. Checks that it exists, and is required with event_ids.',
    },
    event_ids: {
      type: 'array',
      items: uuidJsonSchema,
      minItems: 1,
      maxItems: AGENT_ACCESS_CHECK_WORKFLOW_MAX_EVENT_IDS,
      uniqueItems: true,
      description: 'IDs from list_trigger_events, checked against the trigger in this order.',
    },
  },
  required: ['project_id', 'config_path'],
  anyOf: [{required: ['ref']}, {required: ['content'], not: {required: ['commit']}}],
  dependentRequired: {event_ids: ['trigger']},
  additionalProperties: false,
} as const;

const countJsonSchema = {type: 'integer', minimum: 0} as const;

export const checkWorkflowResultJsonSchema = {
  type: 'object',
  properties: {
    valid: {type: 'boolean'},
    ref: {type: 'string'},
    commit: {type: 'string'},
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          message: {type: 'string'},
          path: {type: 'string'},
          reason: {type: 'string'},
        },
        required: ['message'],
        additionalProperties: false,
      },
    },
    errors_total: countJsonSchema,
    errors_truncated: {type: 'boolean'},
    warnings: {type: 'array', items: createDevRunWarningJsonSchema},
    warnings_truncated: {type: 'boolean'},
    triggers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: {type: 'string'},
          source: {type: 'string'},
          event: {type: 'string'},
          filter: {type: 'string'},
        },
        required: ['key', 'source'],
        additionalProperties: false,
      },
    },
    events: {
      type: 'array',
      maxItems: AGENT_ACCESS_CHECK_WORKFLOW_MAX_EVENT_IDS,
      items: {
        type: 'object',
        properties: {
          event_id: uuidJsonSchema,
          result: {
            type: 'string',
            enum: [
              'matched',
              'filtered',
              'filter-error',
              'event-mismatch',
              'payload-unavailable',
              'not-found',
            ],
          },
          source: {type: 'string'},
          event: {type: 'string'},
          received_at: {type: 'string', format: 'date-time'},
          reason: {type: 'string'},
          diagnostic: {
            type: 'object',
            properties: {
              code: {type: 'string'},
              path: {type: 'string'},
              index: {type: 'integer'},
              offset: {type: 'integer', minimum: 0},
              classification: {type: 'string'},
              actual_type: {type: 'string'},
            },
            required: ['code'],
            additionalProperties: false,
          },
        },
        required: ['event_id', 'result'],
        additionalProperties: false,
      },
    },
    event_counts: {
      type: 'object',
      properties: {
        matched: countJsonSchema,
        filtered: countJsonSchema,
        filter_error: countJsonSchema,
        event_mismatch: countJsonSchema,
        payload_unavailable: countJsonSchema,
        not_found: countJsonSchema,
      },
      required: [
        'matched',
        'filtered',
        'filter_error',
        'event_mismatch',
        'payload_unavailable',
        'not_found',
      ],
      additionalProperties: false,
    },
  },
  required: [
    'valid',
    'commit',
    'errors',
    'errors_total',
    'errors_truncated',
    'warnings',
    'warnings_truncated',
    'triggers',
  ],
  additionalProperties: false,
} as const;
