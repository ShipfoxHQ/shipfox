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
const modelTradeoffSchema = z
  .object({
    intelligence: z.enum(['slightly_smarter', 'similar', 'slightly_less_capable']),
    cost: z.enum(['much_cheaper', 'cheaper', 'similar', 'more_expensive', 'much_more_expensive']),
    label: identifierSchema,
  })
  .strict();
const modelChoiceSchema = z
  .object({
    model: identifierSchema,
    label: identifierSchema.nullable(),
    lab: identifierSchema.nullable(),
    provider: identifierSchema,
    harness: z.enum(['pi', 'claude']),
    thinking: thinkingSchema,
    provider_required: z.boolean(),
    is_anchor: z.boolean(),
    is_default: z.boolean(),
    intelligence_index: z.number().finite().nullable(),
    cost_per_task_usd: z.number().finite().nonnegative().nullable(),
    tradeoff: modelTradeoffSchema.nullable(),
  })
  .strict();
const unscoredModelChoiceSchema = modelChoiceSchema.extend({
  intelligence_index: z.null(),
  cost_per_task_usd: z.null(),
  tradeoff: z.null(),
});
const recommendationGroupShape = {
  placeholders: z.array(identifierSchema).min(1),
  notes: z.record(identifierSchema, identifierSchema),
};
const modelRecommendationGroupSchema = z.discriminatedUnion('mode', [
  z
    .object({
      ...recommendationGroupShape,
      mode: z.literal('recommended'),
      choices: z.array(modelChoiceSchema).min(1).max(5),
      scale: identifierSchema,
      attribution: identifierSchema,
      cost_note: identifierSchema,
    })
    .strict(),
  z
    .object({
      ...recommendationGroupShape,
      mode: z.enum(['template_default', 'workspace_default']),
      choices: z.array(unscoredModelChoiceSchema).length(1),
    })
    .strict(),
  z
    .object({
      ...recommendationGroupShape,
      mode: z.literal('choose'),
      choices: z.array(modelChoiceSchema).length(0),
    })
    .strict(),
]);
export type ModelRecommendationGroupDto = z.infer<typeof modelRecommendationGroupSchema>;
export type ModelChoiceDto = z.infer<typeof modelChoiceSchema>;

export const listWorkflowTemplatesInputSchema = z.object({}).strict();
export type ListWorkflowTemplatesInputDto = z.output<typeof listWorkflowTemplatesInputSchema>;

export const getWorkflowTemplateInputSchema = z
  .object({
    template_id: identifierSchema,
    project_id: idSchema,
    options: z.record(identifierSchema, identifierSchema).optional(),
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
  optional: z.boolean(),
  question: z.string().min(1).optional(),
  tradeoff: z.string().min(1).optional(),
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

const writeResultSchema = z
  .object({
    provider: identifierSchema.optional(),
    action: z.string().min(1),
  })
  .strict();

export const getWorkflowTemplateResultSchema = z
  .object({
    template_id: identifierSchema,
    revision: z.number().int().positive(),
    options: z.array(optionSchema),
    workflow_yaml: textSchema,
    guide_markdown: textSchema,
    writes: z.array(writeResultSchema),
    prerequisites: z.array(z.string().min(1)),
    suggested_bindings: providerBindingSchema,
    model_recommendations: z.array(modelRecommendationGroupSchema),
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
    optional: {
      type: 'boolean',
      description:
        'True when the role is opt-in. Ask its question only when a provider is compatible, and pass the role to get_workflow_template only after the user says yes.',
    },
    question: {
      type: 'string',
      minLength: 1,
      description: 'The question that asks the user whether to use an optional role.',
    },
    tradeoff: {
      type: 'string',
      minLength: 1,
      description: 'What choosing an optional role adds and writes.',
    },
    providers: {type: 'array', items: suggestedBinding},
  },
  required: ['role', 'from_project', 'optional', 'providers'],
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
const nullableNumber = {anyOf: [{type: 'number'}, {type: 'null'}]} as const;
const modelTradeoff = {
  type: 'object',
  properties: {
    intelligence: {type: 'string', enum: ['slightly_smarter', 'similar', 'slightly_less_capable']},
    cost: {
      type: 'string',
      enum: ['much_cheaper', 'cheaper', 'similar', 'more_expensive', 'much_more_expensive'],
    },
    label: identifier,
  },
  required: ['intelligence', 'cost', 'label'],
  additionalProperties: false,
} as const;
const modelChoiceProperties = {
  model: identifier,
  label: {anyOf: [identifier, {type: 'null'}]},
  lab: {anyOf: [identifier, {type: 'null'}]},
  provider: identifier,
  harness: {type: 'string', enum: ['pi', 'claude']},
  thinking,
  provider_required: {
    type: 'boolean',
    description:
      'True when the step must name this provider to run this model. Write `provider` into the step.',
  },
  is_anchor: {type: 'boolean', description: 'True for the model the template was tested with.'},
  is_default: {type: 'boolean'},
  intelligence_index: nullableNumber,
  cost_per_task_usd: {anyOf: [{type: 'number', minimum: 0}, {type: 'null'}]},
  tradeoff: {anyOf: [modelTradeoff, {type: 'null'}]},
} as const;
const modelChoiceRequired = [
  'model',
  'label',
  'lab',
  'provider',
  'harness',
  'thinking',
  'provider_required',
  'is_anchor',
  'is_default',
  'intelligence_index',
  'cost_per_task_usd',
  'tradeoff',
] as const;
const modelChoice = {
  type: 'object',
  properties: modelChoiceProperties,
  required: modelChoiceRequired,
  additionalProperties: false,
} as const;
const unscoredModelChoice = {
  type: 'object',
  properties: {
    ...modelChoiceProperties,
    intelligence_index: {type: 'null'},
    cost_per_task_usd: {type: 'null'},
    tradeoff: {type: 'null'},
  },
  required: modelChoiceRequired,
  additionalProperties: false,
} as const;
const recommendationGroupProperties = {
  placeholders: {type: 'array', items: identifier, minItems: 1},
  notes: {type: 'object', propertyNames: identifier, additionalProperties: identifier},
} as const;
const modelRecommendationGroup = {
  oneOf: [
    {
      type: 'object',
      properties: {
        ...recommendationGroupProperties,
        mode: {const: 'recommended'},
        choices: {type: 'array', items: modelChoice, minItems: 1, maxItems: 5},
        scale: identifier,
        attribution: identifier,
        cost_note: identifier,
      },
      required: ['placeholders', 'notes', 'mode', 'choices', 'scale', 'attribution', 'cost_note'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        ...recommendationGroupProperties,
        mode: {type: 'string', enum: ['template_default', 'workspace_default']},
        choices: {type: 'array', items: unscoredModelChoice, minItems: 1, maxItems: 1},
      },
      required: ['placeholders', 'notes', 'mode', 'choices'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        ...recommendationGroupProperties,
        mode: {const: 'choose'},
        choices: {type: 'array', maxItems: 0},
      },
      required: ['placeholders', 'notes', 'mode', 'choices'],
      additionalProperties: false,
    },
  ],
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
const writeResult = {
  type: 'object',
  properties: {
    provider: {
      ...identifier,
      description: 'The provider written to. Omitted when it depends on the user choices.',
    },
    action: {type: 'string', minLength: 1},
  },
  required: ['action'],
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
    options: {
      type: 'object',
      description:
        'The user answer for each template option, keyed by option ID, such as `pr_mode: "ready"`. The returned `workflow_yaml` keeps only the chosen blocks. Omit an option to keep all of its blocks.',
      additionalProperties: identifier,
    },
  },
  required: ['template_id', 'project_id'],
  additionalProperties: {
    ...identifier,
    description:
      'One provider ID per open role, keyed by role name, such as `tracker: "linear"`. Omit roles with `from_project: true`, and optional roles the user did not choose.',
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
          compatible: {
            type: 'boolean',
            description: 'True when every required role has a provider with an active connection.',
          },
          missing_providers: {
            type: 'array',
            items: identifier,
            description: 'Providers of required roles that have no active connection.',
          },
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
    writes: {
      type: 'array',
      description:
        'Every write the template can make, as authored and without conditions. Tell the user the ones that apply to their choices.',
      items: writeResult,
    },
    prerequisites: {
      type: 'array',
      description:
        'Every user action the template can need, as authored and without conditions. Tell the user the ones that apply to their choices.',
      items: {type: 'string', minLength: 1},
    },
    suggested_bindings: {
      type: 'object',
      additionalProperties: {type: 'array', items: identifier},
    },
    model_recommendations: {
      type: 'array',
      description:
        'Model choices per group of model placeholders. `mode` is `recommended`, `template_default`, `workspace_default`, or `choose`; for `choose`, use list_workspace_models.',
      items: modelRecommendationGroup,
    },
  },
  required: [
    'template_id',
    'revision',
    'options',
    'workflow_yaml',
    'guide_markdown',
    'writes',
    'prerequisites',
    'suggested_bindings',
    'model_recommendations',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
