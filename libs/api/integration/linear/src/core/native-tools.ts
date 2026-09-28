import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {AgentToolCallInput} from '@shipfox/api-integration-spi';
import {z} from 'zod';
import type {LinearApiClient, LinearIssueRelationsPage, LinearRelationEdge} from '#api/client.js';
import {LINEAR_NATIVE_PAGE_LIMIT_MAX} from '#core/agent-tools.js';
import {LinearIntegrationProviderError} from '#core/errors.js';

const DEFAULT_PAGE_LIMIT = 50;

export type LinearNativeToolsClient = Pick<
  LinearApiClient,
  'listIssueRelations' | 'listIssueAttachments'
>;

interface LinearNativeToolContext {
  linear: LinearNativeToolsClient;
  accessToken: string;
}

type LinearNativeToolHandler = (
  arguments_: Record<string, unknown>,
  context: LinearNativeToolContext,
) => Promise<CallToolResult>;

type RelationDirection = 'outgoing' | 'incoming';

const pageArgumentsSchema = z
  .object({
    issueId: z.string().min(1),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(LINEAR_NATIVE_PAGE_LIMIT_MAX).optional(),
  })
  .strict();

const relationsCursorSchema = z.object({
  direction: z.enum(['outgoing', 'incoming']),
  after: z.string().nullable(),
});

type RelationsPosition = z.infer<typeof relationsCursorSchema>;

// Tools answered from Linear's GraphQL API because the hosted MCP results are incomplete.
const linearNativeTools: Readonly<Record<string, LinearNativeToolHandler>> = {
  list_issue_relations: listIssueRelations,
  list_issue_attachments: listIssueAttachments,
};

export function isLinearNativeTool(toolId: string): boolean {
  return Object.hasOwn(linearNativeTools, toolId);
}

export async function callLinearNativeTool(
  call: AgentToolCallInput,
  context: LinearNativeToolContext,
): Promise<CallToolResult> {
  const handler = isLinearNativeTool(call.toolId) ? linearNativeTools[call.toolId] : undefined;
  if (!handler) return toolError(`Unknown Linear tool: ${call.toolId}`, 'invalid-request');
  try {
    return await handler(call.arguments, context);
  } catch (error) {
    if (!(error instanceof LinearIntegrationProviderError)) throw error;
    return toolError(error.message, error.reason, {
      retryAfterSeconds: error.retryAfterSeconds,
      status: error.status,
    });
  }
}

async function listIssueRelations(
  arguments_: Record<string, unknown>,
  context: LinearNativeToolContext,
): Promise<CallToolResult> {
  const input = pageArgumentsSchema.safeParse(arguments_);
  if (!input.success) return invalidArguments(input.error);
  const position: RelationsPosition | undefined =
    input.data.cursor === undefined
      ? {direction: 'outgoing', after: null}
      : decodeRelationsCursor(input.data.cursor);
  if (!position)
    return toolError('The cursor is not a list_issue_relations cursor.', 'invalid-request');
  const limit = input.data.limit ?? DEFAULT_PAGE_LIMIT;
  const incomingAfter = position.direction === 'incoming' ? position.after : null;

  const page = await context.linear.listIssueRelations({
    accessToken: context.accessToken,
    issueId: input.data.issueId,
    ...(position.direction === 'outgoing'
      ? {outgoing: {first: limit, after: position.after ?? undefined}}
      : {}),
    incoming: {first: limit, after: incomingAfter ?? undefined},
  });

  const {relations, next} = mergeRelationsPage({page, limit, incomingAfter});
  return toolResult({
    relations,
    hasNextPage: next !== undefined,
    cursor: next === undefined ? null : encodeRelationsCursor(next),
  });
}

/** Fills the page with outgoing relations first, then incoming ones, and says where to resume. */
function mergeRelationsPage(params: {
  page: LinearIssueRelationsPage;
  limit: number;
  incomingAfter: string | null;
}): {relations: ReturnType<typeof relation>[]; next: RelationsPosition | undefined} {
  const {outgoing, incoming} = params.page;
  const relations = (outgoing?.edges ?? []).map((edge) => relation(edge, 'outgoing'));
  if (outgoing?.hasNextPage) {
    return {relations, next: {direction: 'outgoing', after: outgoing.endCursor}};
  }

  const taken = incoming.edges.slice(0, params.limit - relations.length);
  relations.push(...taken.map((edge) => relation(edge, 'incoming')));
  const exhausted = taken.length === incoming.edges.length && !incoming.hasNextPage;
  return {
    relations,
    next: exhausted
      ? undefined
      : {direction: 'incoming', after: taken.at(-1)?.cursor ?? params.incomingAfter},
  };
}

async function listIssueAttachments(
  arguments_: Record<string, unknown>,
  context: LinearNativeToolContext,
): Promise<CallToolResult> {
  const input = pageArgumentsSchema.safeParse(arguments_);
  if (!input.success) return invalidArguments(input.error);

  const page = await context.linear.listIssueAttachments({
    accessToken: context.accessToken,
    issueId: input.data.issueId,
    first: input.data.limit ?? DEFAULT_PAGE_LIMIT,
    after: input.data.cursor,
  });

  return toolResult({
    attachments: page.attachments,
    hasNextPage: page.hasNextPage,
    cursor: page.hasNextPage ? page.endCursor : null,
  });
}

function relation(edge: LinearRelationEdge, direction: RelationDirection) {
  return {
    type: edge.type,
    direction,
    issue: {
      id: edge.issue.id,
      identifier: edge.issue.identifier,
      title: edge.issue.title,
      projectId: edge.issue.projectId,
      archivedAt: edge.issue.archivedAt,
    },
  };
}

function encodeRelationsCursor(position: RelationsPosition): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

function decodeRelationsCursor(cursor: string): RelationsPosition | undefined {
  try {
    const parsed = relationsCursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function toolResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

function invalidArguments(error: z.ZodError): CallToolResult {
  const issue = error.issues[0];
  const path = issue?.path.join('.') || 'arguments';
  return toolError(`Invalid ${path}: ${issue?.message ?? 'invalid value'}`, 'invalid-request');
}

function toolError(
  message: string,
  code: string,
  options: {retryAfterSeconds?: number | undefined; status?: number | undefined} = {},
): CallToolResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent: {
      code,
      ...(options.retryAfterSeconds === undefined
        ? {}
        : {retryAfterSeconds: options.retryAfterSeconds}),
      ...(options.status === undefined ? {} : {status: options.status}),
    },
  };
}
