import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {
  AGENT_ACCESS_DEFAULT_PAGE_LIMIT,
  AGENT_ACCESS_PAGE_LIMIT_MAX,
  AGENT_ACCESS_TEXT_MAX_BYTES,
} from './paged-tools.js';
import {idSchema, utf8CappedString} from './primitives.js';

export const AGENT_ACCESS_INTEGRATION_MAX_TOOLS = 100;
export const AGENT_ACCESS_INTEGRATION_MAX_METHODS = 50;
export const AGENT_ACCESS_INTEGRATION_MAX_EVENTS = 100;

const capabilitySchema = z.enum(['source_control', 'agent_tools']);
const lifecycleStatusSchema = z.enum(['active', 'disabled', 'error']);
const cappedTextSchema = utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES);
const truncationFields = {
  truncated: z.literal(true).optional(),
  total_bytes: z.number().int().nonnegative().optional(),
};

const truncatedDisplayNameSchema = z.object({
  display_name: cappedTextSchema,
  display_name_truncated: truncationFields.truncated,
  display_name_total_bytes: truncationFields.total_bytes,
});

const connectionSummarySchema = z
  .object({
    id: idSchema,
    slug: cappedTextSchema,
    provider: cappedTextSchema,
    ...truncatedDisplayNameSchema.shape,
    lifecycle_status: lifecycleStatusSchema,
    capabilities: z.array(capabilitySchema),
  })
  .strict();

const connectionListItemSchema = connectionSummarySchema
  .extend({
    external_url: cappedTextSchema.optional(),
    external_url_truncated: truncationFields.truncated,
    external_url_total_bytes: truncationFields.total_bytes,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const listIntegrationConnectionsInputSchema = z
  .object({
    capability: capabilitySchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_ACCESS_PAGE_LIMIT_MAX)
      .default(AGENT_ACCESS_DEFAULT_PAGE_LIMIT),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export type ListIntegrationConnectionsInputDto = z.output<
  typeof listIntegrationConnectionsInputSchema
>;

export const listIntegrationConnectionsResultSchema = z
  .object({
    connections: z.array(connectionListItemSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export type ListIntegrationConnectionsResultDto = z.infer<
  typeof listIntegrationConnectionsResultSchema
>;

const toolMethodSchema = z
  .object({
    id: cappedTextSchema,
    description: cappedTextSchema,
    description_truncated: truncationFields.truncated,
    description_total_bytes: truncationFields.total_bytes,
    sensitivity: z.enum(['read', 'write']),
    sensitive: z.boolean(),
  })
  .strict();

const toolSchema = toolMethodSchema
  .extend({
    methods: z.array(toolMethodSchema).max(AGENT_ACCESS_INTEGRATION_MAX_METHODS).optional(),
    methods_truncated: truncationFields.truncated,
  })
  .strict();

export const getIntegrationConnectionToolsInputSchema = z
  .object({
    connection_id: idSchema.optional(),
    slug: cappedTextSchema.min(1).optional(),
  })
  .superRefine((value, context) => {
    if ((value.connection_id === undefined) === (value.slug === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [value.connection_id === undefined ? 'connection_id' : 'slug'],
        message: 'Provide exactly one of connection_id or slug',
      });
    }
  })
  .strict();

export type GetIntegrationConnectionToolsInputDto = z.output<
  typeof getIntegrationConnectionToolsInputSchema
>;

export const getIntegrationConnectionToolsResultSchema = z
  .object({
    connection: connectionSummarySchema,
    tools: z.array(toolSchema).max(AGENT_ACCESS_INTEGRATION_MAX_TOOLS),
    tools_truncated: truncationFields.truncated,
    events: z.array(cappedTextSchema).max(AGENT_ACCESS_INTEGRATION_MAX_EVENTS),
    events_truncated: truncationFields.truncated,
    event_names_truncated: truncationFields.truncated,
  })
  .strict();

export type GetIntegrationConnectionToolsResultDto = z.infer<
  typeof getIntegrationConnectionToolsResultSchema
>;

const uuid = {type: 'string', format: 'uuid'} as const;
const cappedText = {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES} as const;
const truncationJsonFields = {
  truncated: {const: true},
  total_bytes: {type: 'integer', minimum: 0},
} as const;
const capability = {type: 'string', enum: ['source_control', 'agent_tools']} as const;
const lifecycleStatus = {type: 'string', enum: ['active', 'disabled', 'error']} as const;

const connectionSummaryJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    slug: cappedText,
    provider: cappedText,
    display_name: cappedText,
    display_name_truncated: truncationJsonFields.truncated,
    display_name_total_bytes: truncationJsonFields.total_bytes,
    lifecycle_status: lifecycleStatus,
    capabilities: {type: 'array', items: capability},
  },
  required: ['id', 'slug', 'provider', 'display_name', 'lifecycle_status', 'capabilities'],
  additionalProperties: false,
} as const;

const connectionListItemJsonSchema = {
  ...connectionSummaryJsonSchema,
  properties: {
    ...connectionSummaryJsonSchema.properties,
    external_url: cappedText,
    external_url_truncated: truncationJsonFields.truncated,
    external_url_total_bytes: truncationJsonFields.total_bytes,
    created_at: {type: 'string', format: 'date-time'},
    updated_at: {type: 'string', format: 'date-time'},
  },
  required: [...connectionSummaryJsonSchema.required, 'created_at', 'updated_at'],
} as const;

export const listIntegrationConnectionsInputJsonSchema = {
  type: 'object',
  properties: {
    capability,
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_PAGE_LIMIT_MAX,
      default: AGENT_ACCESS_DEFAULT_PAGE_LIMIT,
    },
    cursor: {type: 'string', minLength: 1},
  },
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listIntegrationConnectionsResultJsonSchema = {
  type: 'object',
  properties: {
    connections: {type: 'array', items: connectionListItemJsonSchema},
    next_cursor: {anyOf: [{type: 'string'}, {type: 'null'}]},
  },
  required: ['connections', 'next_cursor'],
  additionalProperties: false,
} as const;

const toolMethodJsonSchema = {
  type: 'object',
  properties: {
    id: cappedText,
    description: cappedText,
    description_truncated: truncationJsonFields.truncated,
    description_total_bytes: truncationJsonFields.total_bytes,
    sensitivity: {type: 'string', enum: ['read', 'write']},
    sensitive: {type: 'boolean'},
  },
  required: ['id', 'description', 'sensitivity', 'sensitive'],
  additionalProperties: false,
} as const;

const toolJsonSchema = {
  ...toolMethodJsonSchema,
  properties: {
    ...toolMethodJsonSchema.properties,
    methods: {
      type: 'array',
      maxItems: AGENT_ACCESS_INTEGRATION_MAX_METHODS,
      items: toolMethodJsonSchema,
    },
    methods_truncated: truncationJsonFields.truncated,
  },
} as const;

export const getIntegrationConnectionToolsInputJsonSchema = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      properties: {connection_id: uuid},
      required: ['connection_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {slug: {...cappedText, minLength: 1}},
      required: ['slug'],
      additionalProperties: false,
    },
  ],
} as const satisfies AgentAccessObjectSchema;

export const getIntegrationConnectionToolsResultJsonSchema = {
  type: 'object',
  properties: {
    connection: connectionSummaryJsonSchema,
    tools: {type: 'array', maxItems: AGENT_ACCESS_INTEGRATION_MAX_TOOLS, items: toolJsonSchema},
    tools_truncated: truncationJsonFields.truncated,
    events: {
      type: 'array',
      maxItems: AGENT_ACCESS_INTEGRATION_MAX_EVENTS,
      items: cappedText,
    },
    events_truncated: truncationJsonFields.truncated,
    event_names_truncated: truncationJsonFields.truncated,
  },
  required: ['connection', 'tools', 'events'],
  additionalProperties: false,
} as const;
