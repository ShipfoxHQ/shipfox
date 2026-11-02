import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {AGENT_ACCESS_DEFAULT_PAGE_LIMIT, AGENT_ACCESS_PAGE_LIMIT_MAX} from './paged-tools.js';
import {idSchema} from './primitives.js';

export const AGENT_ACCESS_CONFIG_COMMIT_MAX_CHANGES = 100;
export const AGENT_ACCESS_CONFIG_COMMIT_MESSAGE_MAX_LENGTH = 4096;
const CONFIG_PATH_MAX_LENGTH = 1024;
const REF_MAX_LENGTH = 256;
const REF_PATTERN = '^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+$';
const GIT_OBJECT_ID_PATTERN = '^[0-9a-f]{40}$';

function isSafeRefInput(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029);
  });
}

const refSchema = z
  .string()
  .min(1)
  .max(REF_MAX_LENGTH)
  .refine(isSafeRefInput, 'Ref contains a control character');
const pathSchema = z.string().min(1).max(CONFIG_PATH_MAX_LENGTH);
const commitIdSchema = z.string().regex(new RegExp(GIT_OBJECT_ID_PATTERN));

const uuidJson = {type: 'string', format: 'uuid'} as const;
const refJson = {
  type: 'string',
  minLength: 1,
  maxLength: REF_MAX_LENGTH,
  pattern: REF_PATTERN,
} as const;
const pathJson = {type: 'string', minLength: 1, maxLength: CONFIG_PATH_MAX_LENGTH} as const;
const commitIdJson = {type: 'string', pattern: GIT_OBJECT_ID_PATTERN} as const;

export const listConfigFilesInputSchema = z
  .object({
    project_id: idSchema,
    ref: refSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_ACCESS_PAGE_LIMIT_MAX)
      .default(AGENT_ACCESS_DEFAULT_PAGE_LIMIT),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type ListConfigFilesInputDto = z.output<typeof listConfigFilesInputSchema>;

export const listConfigFilesResultSchema = z
  .object({
    commit: commitIdSchema,
    files: z
      .array(
        z
          .object({
            path: pathSchema,
            type: z.enum(['file', 'symlink', 'submodule']),
            size_bytes: z.number().int().min(0).nullable(),
          })
          .strict(),
      )
      .max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().min(1).nullable(),
  })
  .strict();
export type ListConfigFilesResultDto = z.infer<typeof listConfigFilesResultSchema>;

export const readConfigFileInputSchema = z
  .object({project_id: idSchema, path: pathSchema, ref: refSchema.optional()})
  .strict();
export type ReadConfigFileInputDto = z.output<typeof readConfigFileInputSchema>;

export const readConfigFileResultSchema = z
  .object({path: pathSchema, commit: commitIdSchema, content: z.string()})
  .strict();
export type ReadConfigFileResultDto = z.infer<typeof readConfigFileResultSchema>;

const configChangeSchema = z.union([
  z.object({path: pathSchema, content: z.string()}).strict(),
  z.object({path: pathSchema, delete: z.literal(true)}).strict(),
]);

export const commitConfigChangesInputSchema = z
  .object({
    project_id: idSchema,
    branch: refSchema,
    expected_head: commitIdSchema.optional(),
    message: z.string().min(1).max(AGENT_ACCESS_CONFIG_COMMIT_MESSAGE_MAX_LENGTH),
    changes: z.array(configChangeSchema).min(1).max(AGENT_ACCESS_CONFIG_COMMIT_MAX_CHANGES),
  })
  .strict();
export type CommitConfigChangesInputDto = z.output<typeof commitConfigChangesInputSchema>;

export const commitConfigChangesResultSchema = z
  .object({branch: refSchema, commit: commitIdSchema, parent: commitIdSchema})
  .strict();
export type CommitConfigChangesResultDto = z.infer<typeof commitConfigChangesResultSchema>;

export const listConfigFilesInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJson,
    ref: {
      ...refJson,
      description:
        'A branch name or a commit id. Defaults to the default branch of the project config.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_PAGE_LIMIT_MAX,
      default: AGENT_ACCESS_DEFAULT_PAGE_LIMIT,
    },
    cursor: {type: 'string', minLength: 1},
  },
  required: ['project_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listConfigFilesResultJsonSchema = {
  type: 'object',
  properties: {
    commit: commitIdJson,
    files: {
      type: 'array',
      maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX,
      items: {
        type: 'object',
        properties: {
          path: pathJson,
          type: {type: 'string', enum: ['file', 'symlink', 'submodule']},
          size_bytes: {anyOf: [{type: 'integer', minimum: 0}, {type: 'null'}]},
        },
        required: ['path', 'type', 'size_bytes'],
        additionalProperties: false,
      },
    },
    next_cursor: {anyOf: [{type: 'string', minLength: 1}, {type: 'null'}]},
  },
  required: ['commit', 'files', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const readConfigFileInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJson,
    path: pathJson,
    ref: {
      ...refJson,
      description:
        'A branch name or a commit id. Defaults to the default branch of the project config.',
    },
  },
  required: ['project_id', 'path'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const readConfigFileResultJsonSchema = {
  type: 'object',
  properties: {path: pathJson, commit: commitIdJson, content: {type: 'string'}},
  required: ['path', 'commit', 'content'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const commitConfigChangesInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJson,
    branch: refJson,
    expected_head: {
      ...commitIdJson,
      description:
        'The commit the branch pointed at when you last read it. Omit it for the first commit to a new branch.',
    },
    message: {
      type: 'string',
      minLength: 1,
      maxLength: AGENT_ACCESS_CONFIG_COMMIT_MESSAGE_MAX_LENGTH,
    },
    changes: {
      type: 'array',
      minItems: 1,
      maxItems: AGENT_ACCESS_CONFIG_COMMIT_MAX_CHANGES,
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {path: pathJson, content: {type: 'string'}},
            required: ['path', 'content'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {path: pathJson, delete: {const: true}},
            required: ['path', 'delete'],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ['project_id', 'branch', 'message', 'changes'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const commitConfigChangesResultJsonSchema = {
  type: 'object',
  properties: {branch: refJson, commit: commitIdJson, parent: commitIdJson},
  required: ['branch', 'commit', 'parent'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
