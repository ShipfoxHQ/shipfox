import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {idSchema} from './primitives.js';

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
    thinking: thinkingSchema.describe('Thinking level used for these measured values.'),
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
      continue;
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
const modelSchema = z
  .object({
    id: identifierSchema,
    provider: identifierSchema,
    harness: harnessSchema,
    thinking: thinkingSchema.describe(
      'Current resolved thinking setting, separate from benchmark effort.',
    ),
    supported_thinking: z
      .array(thinkingSchema)
      .describe('Thinking levels supported by this model and harness.'),
    is_default: z.boolean(),
    price: modelPriceSchema.nullable(),
    references: modelReferencesSchema.describe(
      'Measured values for supported thinking levels. Empty when no benchmark exists.',
    ),
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

export const getWorkflowAuthoringContextInputSchema = z
  .object({project_id: idSchema.optional()})
  .strict();
export type GetWorkflowAuthoringContextInputDto = z.output<
  typeof getWorkflowAuthoringContextInputSchema
>;

export const getWorkflowAuthoringContextResultSchema = z
  .object({
    models: z.array(modelSchema),
    default_model: modelSchema.nullable(),
    attribution: identifierSchema.nullable(),
    model_provider_configured: z.boolean(),
    runners: z.array(identifierSchema),
    secret_names: z.array(identifierSchema),
    variable_names: z.array(identifierSchema),
  })
  .strict()
  .superRefine(({models, attribution}, ctx) => {
    const hasReferences = models.some(({references}) => references.length > 0);
    if ((attribution !== null) !== hasReferences) {
      ctx.addIssue({
        code: 'custom',
        path: ['attribution'],
        message: hasReferences
          ? 'attribution is required when a model has references'
          : 'attribution must be null when no model has references',
      });
    }
  });
export type GetWorkflowAuthoringContextResultDto = z.infer<
  typeof getWorkflowAuthoringContextResultSchema
>;

const identifier = {type: 'string', minLength: 1} as const;
const thinking = {
  type: 'string',
  enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'],
} as const;
const uuid = {type: 'string', format: 'uuid'} as const;
const modelReference = {
  type: 'object',
  properties: {
    thinking: {
      ...thinking,
      description: 'Thinking level used for these measured values.',
    },
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
    provider: identifier,
    harness: {type: 'string', enum: ['pi', 'claude']},
    thinking: {
      ...thinking,
      description: 'Current resolved thinking setting, separate from benchmark effort.',
    },
    supported_thinking: {
      type: 'array',
      items: thinking,
      uniqueItems: true,
      description: 'Thinking levels supported by this model and harness.',
    },
    is_default: {type: 'boolean'},
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
    references: {
      type: 'array',
      items: modelReference,
      description: 'Measured values for supported thinking levels. Empty when no benchmark exists.',
    },
  },
  required: [
    'id',
    'provider',
    'harness',
    'thinking',
    'supported_thinking',
    'is_default',
    'price',
    'references',
  ],
  additionalProperties: false,
} as const;

export const getWorkflowAuthoringContextInputJsonSchema = {
  type: 'object',
  properties: {project_id: uuid},
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getWorkflowAuthoringContextResultJsonSchema = {
  type: 'object',
  properties: {
    models: {type: 'array', items: model},
    default_model: {anyOf: [model, {type: 'null'}]},
    attribution: {anyOf: [identifier, {type: 'null'}]},
    model_provider_configured: {type: 'boolean'},
    runners: {type: 'array', items: identifier},
    secret_names: {type: 'array', items: identifier},
    variable_names: {type: 'array', items: identifier},
  },
  required: [
    'models',
    'default_model',
    'attribution',
    'model_provider_configured',
    'runners',
    'secret_names',
    'variable_names',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
