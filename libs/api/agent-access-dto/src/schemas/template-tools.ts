import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {idSchema, utf8CappedString} from './primitives.js';

const identifierSchema = z.string().min(1);
const textSchema = utf8CappedString(128 * 1024);
const providerBindingSchema = z.record(identifierSchema, z.array(identifierSchema));

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
    providers: {type: 'array', items: suggestedBinding},
  },
  required: ['role', 'providers'],
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
  additionalProperties: identifier,
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
  },
  required: [
    'template_id',
    'revision',
    'options',
    'workflow_yaml',
    'guide_markdown',
    'suggested_bindings',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
