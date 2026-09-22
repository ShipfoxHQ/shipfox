import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {idSchema} from './primitives.js';

const identifierSchema = z.string().min(1);
const modelReferenceSchema = z
  .object({
    intelligence_index: z.number().finite(),
    cost_per_task_usd: z.number().finite().nonnegative(),
    scale: identifierSchema,
  })
  .strict();
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
    harness: identifierSchema,
    thinking: identifierSchema,
    is_default: z.boolean(),
    price: modelPriceSchema.nullable(),
    reference: modelReferenceSchema.nullable(),
  })
  .strict();

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
  .strict();
export type GetWorkflowAuthoringContextResultDto = z.infer<
  typeof getWorkflowAuthoringContextResultSchema
>;

const identifier = {type: 'string', minLength: 1} as const;
const uuid = {type: 'string', format: 'uuid'} as const;
const model = {
  type: 'object',
  properties: {
    id: identifier,
    provider: identifier,
    harness: identifier,
    thinking: identifier,
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
    reference: {
      anyOf: [
        {
          type: 'object',
          properties: {
            intelligence_index: {type: 'number'},
            cost_per_task_usd: {type: 'number', minimum: 0},
            scale: identifier,
          },
          required: ['intelligence_index', 'cost_per_task_usd', 'scale'],
          additionalProperties: false,
        },
        {type: 'null'},
      ],
    },
  },
  required: ['id', 'provider', 'harness', 'thinking', 'is_default', 'price', 'reference'],
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
