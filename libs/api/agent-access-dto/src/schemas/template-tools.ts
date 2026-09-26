import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {idSchema, utf8CappedString} from './primitives.js';

const identifierSchema = z.string().min(1);
const textSchema = utf8CappedString(128 * 1024);
const providerBindingSchema = z.record(identifierSchema, z.array(identifierSchema));
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
const measuredReferenceSchema = z
  .object({
    thinking: thinkingSchema,
    intelligence_index: z.number().finite(),
    cost_per_task_usd: z.number().finite().nonnegative(),
    scale: identifierSchema,
  })
  .strict();
const priceSchema = z
  .object({input: z.number().finite().nonnegative(), output: z.number().finite().nonnegative()})
  .strict();
const suggestedModelSchema = z
  .object({
    id: identifierSchema,
    provider: identifierSchema,
    harness: z.enum(['pi', 'claude']),
    thinking: thinkingSchema,
    is_default: z.boolean(),
    price: priceSchema.nullable(),
    reference: measuredReferenceSchema.nullable(),
    below_reference: z.literal(true).optional(),
  })
  .strict();
const modelSuggestionSchema = z
  .object({
    reference: z
      .object({
        model: identifierSchema,
        thinking: thinkingSchema,
        intelligence_index: z.number().finite(),
      })
      .strict()
      .nullable(),
    note: identifierSchema.nullable(),
    outcome: z.enum(['suggested', 'list']),
    models: z.array(suggestedModelSchema),
    attribution: identifierSchema.nullable(),
  })
  .strict()
  .superRefine(({reference, outcome, models}, context) => {
    if (outcome === 'suggested' && reference === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference'],
        message: 'A suggestion needs a scored tested combination',
      });
    }
    if (outcome === 'list') {
      for (const [index, model] of models.entries()) {
        if (model.below_reference !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['models', index, 'below_reference'],
            message: 'A list must not rank choices',
          });
        }
      }
    }
  });

export const listWorkflowTemplatesInputSchema = z.object({}).strict();
export type ListWorkflowTemplatesInputDto = z.output<typeof listWorkflowTemplatesInputSchema>;

export const getWorkflowTemplateInputSchema = z
  .object({
    template_id: identifierSchema,
    project_id: idSchema,
  })
  .catchall(identifierSchema);
export type GetWorkflowTemplateInputDto = z.output<typeof getWorkflowTemplateInputSchema>;

const suggestedBindingSchema = z.object({
  provider: identifierSchema,
  compatible: z.boolean(),
  suggested_bindings: z.array(identifierSchema),
});

const roleResultSchema = z.object({
  role: identifierSchema,
  from_project: z.boolean(),
  providers: z.array(suggestedBindingSchema),
});

const optionChoiceSchema = z.object({
  id: identifierSchema,
  label: z.string().min(1).optional(),
  default: z.boolean().optional(),
  tradeoff: z.string().min(1).optional(),
});

const optionSchema = z.object({
  id: identifierSchema,
  question: z.string().min(1).optional(),
  choices: z.array(optionChoiceSchema),
  tradeoff: z.string().min(1).optional(),
  tradeoffs: z.record(identifierSchema, z.string().min(1)).optional(),
  applies_to: z.array(identifierSchema).optional(),
});

export const listWorkflowTemplatesResultSchema = z
  .object({
    templates: z.array(
      z.object({
        id: identifierSchema,
        revision: z.number().int().positive(),
        added_at: z.string().date(),
        title: textSchema,
        summary: textSchema,
        compatible: z.boolean(),
        missing_providers: z.array(identifierSchema),
        roles: z.array(roleResultSchema),
      }),
    ),
  })
  .strict();
export type ListWorkflowTemplatesResultDto = z.infer<typeof listWorkflowTemplatesResultSchema>;

export const getWorkflowTemplateResultSchema = z
  .object({
    template_id: identifierSchema,
    revision: z.number().int().positive(),
    options: z.array(optionSchema),
    workflow_yaml: textSchema,
    guide_markdown: textSchema,
    suggested_bindings: providerBindingSchema,
    suggested_models: z.record(identifierSchema, modelSuggestionSchema),
  })
  .strict();
export type GetWorkflowTemplateResultDto = z.infer<typeof getWorkflowTemplateResultSchema>;

const identifier = {type: 'string', minLength: 1} as const;
const uuid = {type: 'string', format: 'uuid'} as const;
const text = {type: 'string', maxLength: 128 * 1024} as const;
const suggestedBinding = {
  type: 'object',
  properties: {
    provider: identifier,
    compatible: {type: 'boolean'},
    suggested_bindings: {type: 'array', items: identifier},
  },
  required: ['provider', 'compatible', 'suggested_bindings'],
  additionalProperties: false,
} as const;
const roleResult = {
  type: 'object',
  properties: {
    role: identifier,
    from_project: {
      type: 'boolean',
      description:
        "True when the project's source connection sets this role. Omit it from get_workflow_template.",
    },
    providers: {type: 'array', items: suggestedBinding},
  },
  required: ['role', 'from_project', 'providers'],
  additionalProperties: false,
} as const;
const optionChoice = {
  type: 'object',
  properties: {
    id: identifier,
    label: {type: 'string', minLength: 1},
    default: {type: 'boolean'},
    tradeoff: {type: 'string', minLength: 1},
  },
  required: ['id'],
  additionalProperties: false,
} as const;
const thinking = {
  type: 'string',
  enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'],
} as const;
const measuredReference = {
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
const suggestedModel = {
  type: 'object',
  properties: {
    id: identifier,
    provider: identifier,
    harness: {type: 'string', enum: ['pi', 'claude']},
    thinking,
    is_default: {type: 'boolean'},
    price: {
      anyOf: [
        {
          type: 'object',
          properties: {input: {type: 'number', minimum: 0}, output: {type: 'number', minimum: 0}},
          required: ['input', 'output'],
          additionalProperties: false,
        },
        {type: 'null'},
      ],
    },
    reference: {anyOf: [measuredReference, {type: 'null'}]},
    below_reference: {type: 'boolean', enum: [true]},
  },
  required: ['id', 'provider', 'harness', 'thinking', 'is_default', 'price', 'reference'],
  additionalProperties: false,
} as const;
const modelSuggestion = {
  type: 'object',
  properties: {
    reference: {
      anyOf: [
        {
          type: 'object',
          properties: {model: identifier, thinking, intelligence_index: {type: 'number'}},
          required: ['model', 'thinking', 'intelligence_index'],
          additionalProperties: false,
        },
        {type: 'null'},
      ],
    },
    note: {anyOf: [identifier, {type: 'null'}]},
    outcome: {type: 'string', enum: ['suggested', 'list']},
    models: {type: 'array', items: suggestedModel},
    attribution: {anyOf: [identifier, {type: 'null'}]},
  },
  required: ['reference', 'note', 'outcome', 'models', 'attribution'],
  additionalProperties: false,
  if: {properties: {outcome: {const: 'suggested'}}, required: ['outcome']},
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema uses "then" for a conditional branch.
  then: {properties: {reference: {type: 'object'}}},
  else: {
    properties: {
      models: {type: 'array', items: {type: 'object', not: {required: ['below_reference']}}},
    },
  },
} as const;
const option = {
  type: 'object',
  properties: {
    id: identifier,
    question: {type: 'string', minLength: 1},
    choices: {type: 'array', items: optionChoice},
    tradeoff: {type: 'string', minLength: 1},
    tradeoffs: {type: 'object', additionalProperties: {type: 'string', minLength: 1}},
    applies_to: {type: 'array', items: identifier},
  },
  required: ['id', 'choices'],
  additionalProperties: false,
} as const;

export const listWorkflowTemplatesInputJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getWorkflowTemplateInputJsonSchema = {
  type: 'object',
  properties: {
    template_id: identifier,
    project_id: uuid,
  },
  required: ['template_id', 'project_id'],
  additionalProperties: {
    ...identifier,
    description:
      'One provider ID per open role, keyed by role name, such as `tracker: "linear"`. Omit roles with `from_project: true`.',
  },
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowTemplatesResultJsonSchema = {
  type: 'object',
  properties: {
    templates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: identifier,
          revision: {type: 'integer', minimum: 1},
          added_at: {type: 'string', format: 'date'},
          title: text,
          summary: text,
          compatible: {type: 'boolean'},
          missing_providers: {type: 'array', items: identifier},
          roles: {type: 'array', items: roleResult},
        },
        required: [
          'id',
          'revision',
          'added_at',
          'title',
          'summary',
          'compatible',
          'missing_providers',
          'roles',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['templates'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getWorkflowTemplateResultJsonSchema = {
  type: 'object',
  properties: {
    template_id: identifier,
    revision: {type: 'integer', minimum: 1},
    options: {type: 'array', items: option},
    workflow_yaml: text,
    guide_markdown: text,
    suggested_bindings: {
      type: 'object',
      additionalProperties: {type: 'array', items: identifier},
    },
    suggested_models: {
      type: 'object',
      propertyNames: identifier,
      additionalProperties: modelSuggestion,
    },
  },
  required: [
    'template_id',
    'revision',
    'options',
    'workflow_yaml',
    'guide_markdown',
    'suggested_bindings',
    'suggested_models',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
