import type {AgentToolCatalogEntry, AgentToolSelectionCatalog} from '@shipfox/api-integration-spi';
import {z} from 'zod';

const pageSize = z.number().int().min(1).max(100);
const identifier = z.string().min(1);
const environments = z.array(z.string().min(1));
const statsPeriod = z.string().regex(/^[1-9]\d*[dhmsw]$/);

export const sentryToolInputs = {
  'list-projects': z.strictObject({
    query: z.string().optional(),
    limit: pageSize.optional(),
    cursor: identifier.optional(),
  }),
  'search-issues': z
    .strictObject({
      query: z.string().optional(),
      projectIds: z.array(identifier).optional(),
      environments: environments.optional(),
      statsPeriod: statsPeriod.optional(),
      start: z.iso.datetime({offset: true, local: true}).optional(),
      end: z.iso.datetime({offset: true, local: true}).optional(),
      sort: z.enum(['date', 'new', 'freq']).optional(),
      limit: pageSize.optional(),
      cursor: identifier.optional(),
    })
    .refine(
      ({statsPeriod, start, end}) =>
        (start === undefined && end === undefined) ||
        (statsPeriod === undefined && start !== undefined && end !== undefined),
      {message: 'Provide both start and end, without statsPeriod'},
    )
    .refine(
      ({start, end}) =>
        start === undefined || end === undefined || Date.parse(start) < Date.parse(end),
      {message: 'start must be before end'},
    ),
  'get-issue': z.strictObject({issueId: identifier}),
  'get-issue-event': z.strictObject({
    issueId: identifier,
    eventId: identifier.optional(),
    environments: environments.optional(),
  }),
} as const;

function inputSchema(schema: z.ZodType): Record<string, unknown> {
  const {$schema: _, ...jsonSchema} = z.toJSONSchema(schema, {unrepresentable: 'any'});
  return jsonSchema;
}

const connectionScope = (_arguments: Readonly<Record<string, unknown>>) => ({
  kind: 'connection' as const,
});
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'nextCursor', 'truncated', 'sourceUrl'],
  properties: {
    data: {anyOf: [{type: 'object'}, {type: 'array', items: {type: 'object'}}]},
    nextCursor: {type: ['string', 'null']},
    truncated: {type: 'boolean'},
    sourceUrl: {type: 'string'},
  },
} as const;

export const sentryAgentToolCatalog = [
  {
    id: 'list-projects',
    description:
      'List projects across the authorized Sentry organization. This connection can read organization-wide project data, not only projects named in a workflow. Results are diagnostic evidence, not a root-cause conclusion.',
    inputSchema: inputSchema(sentryToolInputs['list-projects']),
  },
  {
    id: 'search-issues',
    description:
      "Search issues across the authorized Sentry organization. Defaults to unresolved issues seen in the last 24 hours, sorted by last seen. An empty query includes all statuses. Counts retain Sentry's lifetime or filtered scope; search results are diagnostic evidence, not proof of root cause.",
    inputSchema: inputSchema(sentryToolInputs['search-issues']),
  },
  {
    id: 'get-issue',
    description:
      'Read issue metadata by ID across the authorized Sentry organization. Use get-issue-event separately for stack frames. Issue metadata is diagnostic evidence, not proof of root cause.',
    inputSchema: inputSchema(sentryToolInputs['get-issue']),
  },
  {
    id: 'get-issue-event',
    description:
      'Read an issue event by issue ID across the authorized Sentry organization. The default latest event applies to the supplied environments independently of any previous search time window. Missing frames remain missing; an event is diagnostic evidence, not proof of root cause or aggregate impact.',
    inputSchema: inputSchema(sentryToolInputs['get-issue-event']),
  },
].map((entry) => ({
  ...entry,
  sensitivity: 'read' as const,
  sensitive: true,
  requiredScope: 'read' as const,
  repositoryScope: connectionScope,
  outputSchema,
})) satisfies readonly AgentToolCatalogEntry<'read'>[];

export type SentryAgentToolId = (typeof sentryAgentToolCatalog)[number]['id'];

export const sentryAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: sentryAgentToolCatalog.map((entry) => ({
    token: entry.id,
    kind: 'standalone',
    sensitivity: entry.sensitivity,
    sensitive: entry.sensitive,
  })),
};
