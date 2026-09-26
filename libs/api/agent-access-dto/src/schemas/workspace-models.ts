import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {AGENT_ACCESS_PAGE_LIMIT_MAX, AGENT_ACCESS_TEXT_MAX_BYTES} from './paged-tools.js';
import {utf8CappedString} from './primitives.js';

export const AGENT_ACCESS_WORKSPACE_MODELS_DEFAULT_PAGE_LIMIT = 25;

const identifierSchema = z.string().min(1);
const harnessSchema = z.enum(['pi', 'claude']);
const thinkingSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'default',
]);
const modelReferenceSchema = z
  .object({
    thinking: thinkingSchema,
    intelligence_index: z.number().finite(),
    cost_per_task_usd: z.number().finite().nonnegative(),
    scale: identifierSchema,
  })
  .strict();
const modelReferencesSchema = z.array(modelReferenceSchema).superRefine((references, ctx) => {
  const seen = new Set<string>();
  for (const [index, reference] of references.entries()) {
    if (seen.has(reference.thinking)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'thinking'],
        message: 'Each thinking level can have only one measured reference.',
      });
    }
    seen.add(reference.thinking);
  }
});
const modelPriceSchema = z
  .object({
    input: z.number().finite().nonnegative(),
    output: z.number().finite().nonnegative(),
  })
  .strict();
const workspaceModelSchema = z
  .object({
    id: identifierSchema,
    label: identifierSchema.nullable(),
    lab: identifierSchema.nullable(),
    provider: identifierSchema,
    harness: harnessSchema,
    supported_thinking: z.array(thinkingSchema),
    price: modelPriceSchema.nullable(),
    references: modelReferencesSchema,
    is_default: z.boolean(),
  })
  .strict()
  .superRefine(({harness, supported_thinking: supportedThinking, references}, ctx) => {
    const harnessLevels =
      harness === 'pi'
        ? new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'])
        : new Set(['low', 'medium', 'high', 'xhigh', 'max', 'default']);
    const supportedLevels = new Set(supportedThinking);

    for (const [index, level] of supportedThinking.entries()) {
      if (!harnessLevels.has(level)) {
        ctx.addIssue({
          code: 'custom',
          path: ['supported_thinking', index],
          message: 'supported_thinking must contain levels supported by the model harness',
        });
      }
      if (supportedThinking.indexOf(level) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['supported_thinking', index],
          message: 'supported_thinking must not contain duplicate levels',
        });
      }
    }

    for (const [index, reference] of references.entries()) {
      if (!supportedLevels.has(reference.thinking) || !harnessLevels.has(reference.thinking)) {
        ctx.addIssue({
          code: 'custom',
          path: ['references', index, 'thinking'],
          message: 'reference thinking must be supported by the model and harness',
        });
      }
    }
  });

const pageInputFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(AGENT_ACCESS_PAGE_LIMIT_MAX)
    .default(AGENT_ACCESS_WORKSPACE_MODELS_DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).optional(),
};
const filterSchema = utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).min(1);

export const listWorkspaceModelsInputSchema = z
  .object({
    provider: filterSchema.optional(),
    lab: filterSchema.optional(),
    query: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).optional(),
    scored_only: z.boolean().optional(),
    ...pageInputFields,
  })
  .strict();
export type ListWorkspaceModelsInputDto = z.output<typeof listWorkspaceModelsInputSchema>;

export const listWorkspaceModelsResultSchema = z
  .object({
    models: z.array(workspaceModelSchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().min(1).nullable(),
  })
  .strict();
export type ListWorkspaceModelsResultDto = z.infer<typeof listWorkspaceModelsResultSchema>;

const thinking = {
  type: 'string',
  enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'],
} as const;
const identifier = {type: 'string', minLength: 1} as const;
const modelReference = {
  type: 'object',
  properties: {
    thinking,
    intelligence_index: {type: 'number'},
    cost_per_task_usd: {type: 'number', minimum: 0},
    scale: identifier,
  },
  required: ['thinking', 'intelligence_index', 'cost_per_task_usd', 'scale'],
  additionalProperties: false,
} as const;
const model = {
  type: 'object',
  properties: {
    id: identifier,
    label: {anyOf: [identifier, {type: 'null'}]},
    lab: {anyOf: [identifier, {type: 'null'}]},
    provider: identifier,
    harness: {type: 'string', enum: ['pi', 'claude']},
    supported_thinking: {type: 'array', items: thinking, uniqueItems: true},
    price: {
      anyOf: [
        {
          type: 'object',
          properties: {
            input: {type: 'number', minimum: 0},
            output: {type: 'number', minimum: 0},
          },
          required: ['input', 'output'],
          additionalProperties: false,
        },
        {type: 'null'},
      ],
    },
    references: {type: 'array', items: modelReference},
    is_default: {type: 'boolean'},
  },
  required: [
    'id',
    'label',
    'lab',
    'provider',
    'harness',
    'supported_thinking',
    'price',
    'references',
    'is_default',
  ],
  additionalProperties: false,
} as const;

export const listWorkspaceModelsInputJsonSchema = {
  type: 'object',
  properties: {
    provider: {type: 'string', minLength: 1, maxLength: AGENT_ACCESS_TEXT_MAX_BYTES},
    lab: {type: 'string', minLength: 1, maxLength: AGENT_ACCESS_TEXT_MAX_BYTES},
    query: {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES},
    scored_only: {type: 'boolean'},
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_PAGE_LIMIT_MAX,
      default: AGENT_ACCESS_WORKSPACE_MODELS_DEFAULT_PAGE_LIMIT,
    },
    cursor: {type: 'string', minLength: 1},
  },
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkspaceModelsResultJsonSchema = {
  type: 'object',
  properties: {
    models: {type: 'array', maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX, items: model},
    next_cursor: {anyOf: [{type: 'string', minLength: 1}, {type: 'null'}]},
  },
  required: ['models', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
