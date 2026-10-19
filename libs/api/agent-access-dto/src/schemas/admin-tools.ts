import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {dateTimeSchema, idSchema} from './primitives.js';

export const AGENT_ACCESS_FIND_USERS_DEFAULT_LIMIT = 10;
export const AGENT_ACCESS_FIND_USERS_LIMIT_MAX = 25;
export const AGENT_ACCESS_FIND_RESOURCES_DEFAULT_LIMIT = 10;
export const AGENT_ACCESS_FIND_RESOURCES_LIMIT_MAX = 25;

const SEARCH_MAX_LENGTH = 256;
const RESOURCE_SEARCH_MAX_LENGTH = 100;
const SEARCH_MAX_TERMS = 10;
const SEARCH_MAX_TERM_LENGTH = 100;
const CURSOR_MAX_LENGTH = 512;
const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const WHITESPACE_RE = /\s+/u;

const searchSchema = z
  .string()
  .max(SEARCH_MAX_LENGTH)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  })
  .superRefine((value, context) => {
    const terms = value.trim().split(WHITESPACE_RE).filter(Boolean);
    if (terms.length === 0) {
      context.addIssue({code: 'custom', message: 'must not be blank'});
    } else if (terms.length > SEARCH_MAX_TERMS) {
      context.addIssue({code: 'custom', message: `accepts at most ${SEARCH_MAX_TERMS} terms`});
    } else if (terms.some((term) => term.length > SEARCH_MAX_TERM_LENGTH)) {
      context.addIssue({
        code: 'custom',
        message: `terms must be at most ${SEARCH_MAX_TERM_LENGTH} characters`,
      });
    }
  });

export const findUsersInputSchema = z
  .object({
    search: searchSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_ACCESS_FIND_USERS_LIMIT_MAX)
      .default(AGENT_ACCESS_FIND_USERS_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
  })
  .strict();
export type FindUsersInputDto = z.output<typeof findUsersInputSchema>;

const userWorkspaceSchema = z
  .object({
    workspace_id: idSchema,
    workspace_slug: z.string().min(1),
    role: z.string().min(1),
    status: z.string().min(1),
  })
  .strict();

const foundUserSchema = z
  .object({
    id: idSchema,
    email: z.string().min(1),
    name: z.string().nullable(),
    status: z.string().min(1),
    admin_role: z.string().min(1).nullable(),
    workspaces: z.array(userWorkspaceSchema),
  })
  .strict();

export const findUsersResultSchema = z
  .object({
    users: z.array(foundUserSchema).max(AGENT_ACCESS_FIND_USERS_LIMIT_MAX),
    next_cursor: z.string().min(1).nullable(),
  })
  .strict();
export type FindUsersResultDto = z.infer<typeof findUsersResultSchema>;

const resourceSearchSchema = z
  .string()
  .trim()
  .min(1)
  .max(RESOURCE_SEARCH_MAX_LENGTH)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });
const resourceLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(AGENT_ACCESS_FIND_RESOURCES_LIMIT_MAX)
  .default(AGENT_ACCESS_FIND_RESOURCES_DEFAULT_LIMIT);
const workspaceStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const findWorkspacesInputSchema = z
  .object({
    search: resourceSearchSchema.optional(),
    status: workspaceStatusSchema.optional(),
    limit: resourceLimitSchema,
    cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
  })
  .strict();
export type FindWorkspacesInputDto = z.output<typeof findWorkspacesInputSchema>;

const foundWorkspaceSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    slug: z.string().min(1),
    status: workspaceStatusSchema,
    member_count: z.number().int().nonnegative(),
    created_at: dateTimeSchema,
  })
  .strict();

export const findWorkspacesResultSchema = z
  .object({
    workspaces: z.array(foundWorkspaceSchema).max(AGENT_ACCESS_FIND_RESOURCES_LIMIT_MAX),
    next_cursor: z.string().min(1).nullable(),
  })
  .strict();
export type FindWorkspacesResultDto = z.infer<typeof findWorkspacesResultSchema>;

export const findProjectsInputSchema = z
  .object({
    search: resourceSearchSchema.optional(),
    limit: resourceLimitSchema,
    cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
  })
  .strict();
export type FindProjectsInputDto = z.output<typeof findProjectsInputSchema>;

const foundProjectSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    slug: z.string().min(1),
    workspace_id: idSchema,
    workspace_slug: z.string().min(1).nullable(),
    created_at: dateTimeSchema,
  })
  .strict();

export const findProjectsResultSchema = z
  .object({
    projects: z.array(foundProjectSchema).max(AGENT_ACCESS_FIND_RESOURCES_LIMIT_MAX),
    next_cursor: z.string().min(1).nullable(),
  })
  .strict();
export type FindProjectsResultDto = z.infer<typeof findProjectsResultSchema>;

export const startImpersonationInputSchema = z.object({workspace_id: idSchema}).strict();
export type StartImpersonationInputDto = z.output<typeof startImpersonationInputSchema>;

export const startImpersonationResultSchema = z
  .object({
    window_id: idSchema,
    workspace_id: idSchema,
    started_at: dateTimeSchema,
    deadline_at: dateTimeSchema,
  })
  .strict();
export type StartImpersonationResultDto = z.infer<typeof startImpersonationResultSchema>;

export const stopImpersonationInputSchema = z.object({workspace_id: idSchema}).strict();
export type StopImpersonationInputDto = z.output<typeof stopImpersonationInputSchema>;

export const stopImpersonationResultSchema = z
  .object({
    window_id: idSchema,
    workspace_id: idSchema,
    ended_at: dateTimeSchema,
  })
  .strict();
export type StopImpersonationResultDto = z.infer<typeof stopImpersonationResultSchema>;

const uuid = {type: 'string', format: 'uuid'} as const;
const dateTime = {type: 'string', format: 'date-time'} as const;
const nullableString = {anyOf: [{type: 'string', minLength: 1}, {type: 'null'}]} as const;

export const findUsersInputJsonSchema = {
  type: 'object',
  properties: {
    search: {type: 'string', minLength: 1, maxLength: SEARCH_MAX_LENGTH},
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_FIND_USERS_LIMIT_MAX,
      default: AGENT_ACCESS_FIND_USERS_DEFAULT_LIMIT,
    },
    cursor: {type: 'string', minLength: 1, maxLength: CURSOR_MAX_LENGTH},
  },
  required: ['search'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const findUsersResultJsonSchema = {
  type: 'object',
  properties: {
    users: {
      type: 'array',
      maxItems: AGENT_ACCESS_FIND_USERS_LIMIT_MAX,
      items: {
        type: 'object',
        properties: {
          id: uuid,
          email: {type: 'string', minLength: 1},
          name: {anyOf: [{type: 'string'}, {type: 'null'}]},
          status: {type: 'string', minLength: 1},
          admin_role: nullableString,
          workspaces: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                workspace_id: uuid,
                workspace_slug: {type: 'string', minLength: 1},
                role: {type: 'string', minLength: 1},
                status: {type: 'string', minLength: 1},
              },
              required: ['workspace_id', 'workspace_slug', 'role', 'status'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'email', 'name', 'status', 'admin_role', 'workspaces'],
        additionalProperties: false,
      },
    },
    next_cursor: nullableString,
  },
  required: ['users', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const resourceSearchJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: RESOURCE_SEARCH_MAX_LENGTH,
} as const;
const resourceLimitJsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: AGENT_ACCESS_FIND_RESOURCES_LIMIT_MAX,
  default: AGENT_ACCESS_FIND_RESOURCES_DEFAULT_LIMIT,
} as const;
const cursorJsonSchema = {type: 'string', minLength: 1, maxLength: CURSOR_MAX_LENGTH} as const;
const workspaceStatusJsonSchema = {
  type: 'string',
  enum: ['active', 'suspended', 'deleted'],
} as const;

export const findWorkspacesInputJsonSchema = {
  type: 'object',
  properties: {
    search: resourceSearchJsonSchema,
    status: workspaceStatusJsonSchema,
    limit: resourceLimitJsonSchema,
    cursor: cursorJsonSchema,
  },
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const findWorkspacesResultJsonSchema = {
  type: 'object',
  properties: {
    workspaces: {
      type: 'array',
      maxItems: AGENT_ACCESS_FIND_RESOURCES_LIMIT_MAX,
      items: {
        type: 'object',
        properties: {
          id: uuid,
          name: {type: 'string'},
          slug: {type: 'string', minLength: 1},
          status: workspaceStatusJsonSchema,
          member_count: {type: 'integer', minimum: 0},
          created_at: dateTime,
        },
        required: ['id', 'name', 'slug', 'status', 'member_count', 'created_at'],
        additionalProperties: false,
      },
    },
    next_cursor: nullableString,
  },
  required: ['workspaces', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const findProjectsInputJsonSchema = {
  type: 'object',
  properties: {
    search: resourceSearchJsonSchema,
    limit: resourceLimitJsonSchema,
    cursor: cursorJsonSchema,
  },
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const findProjectsResultJsonSchema = {
  type: 'object',
  properties: {
    projects: {
      type: 'array',
      maxItems: AGENT_ACCESS_FIND_RESOURCES_LIMIT_MAX,
      items: {
        type: 'object',
        properties: {
          id: uuid,
          name: {type: 'string'},
          slug: {type: 'string', minLength: 1},
          workspace_id: uuid,
          workspace_slug: nullableString,
          created_at: dateTime,
        },
        required: ['id', 'name', 'slug', 'workspace_id', 'workspace_slug', 'created_at'],
        additionalProperties: false,
      },
    },
    next_cursor: nullableString,
  },
  required: ['projects', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

/** The workspace a read tool targets on the admin endpoint, added to that tool's own input. */
export const adminWorkspaceIdSchema = idSchema;
export const adminWorkspaceIdJsonSchema = uuid;

export const startImpersonationInputJsonSchema = {
  type: 'object',
  properties: {workspace_id: uuid},
  required: ['workspace_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const startImpersonationResultJsonSchema = {
  type: 'object',
  properties: {window_id: uuid, workspace_id: uuid, started_at: dateTime, deadline_at: dateTime},
  required: ['window_id', 'workspace_id', 'started_at', 'deadline_at'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const stopImpersonationInputJsonSchema = startImpersonationInputJsonSchema;

export const stopImpersonationResultJsonSchema = {
  type: 'object',
  properties: {window_id: uuid, workspace_id: uuid, ended_at: dateTime},
  required: ['window_id', 'workspace_id', 'ended_at'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
