import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {idSchema} from './primitives.js';

const identifierSchema = z.string().min(1);
const modelSchema = z.object({
  id: identifierSchema,
  provider: identifierSchema,
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
  properties: {id: identifier, provider: identifier},
  required: ['id', 'provider'],
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
    model_provider_configured: {type: 'boolean'},
    runners: {type: 'array', items: identifier},
    secret_names: {type: 'array', items: identifier},
    variable_names: {type: 'array', items: identifier},
  },
  required: [
    'models',
    'default_model',
    'model_provider_configured',
    'runners',
    'secret_names',
    'variable_names',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
