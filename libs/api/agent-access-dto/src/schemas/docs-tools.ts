import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';

export const searchDocsInputSchema = z.object({query: z.string().min(1).max(200)}).strict();
export const searchDocsResultSchema = z
  .object({
    hits: z
      .array(
        z
          .object({
            slug: z.string(),
            title: z.string(),
            excerpt: z.string(),
            uri: z.string(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

export const searchDocsInputJsonSchema = {
  type: 'object',
  properties: {query: {type: 'string', minLength: 1, maxLength: 200}},
  required: ['query'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const searchDocsResultJsonSchema = {
  type: 'object',
  properties: {
    hits: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          slug: {type: 'string'},
          title: {type: 'string'},
          excerpt: {type: 'string'},
          uri: {type: 'string'},
        },
        required: ['slug', 'title', 'excerpt', 'uri'],
        additionalProperties: false,
      },
    },
  },
  required: ['hits'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
