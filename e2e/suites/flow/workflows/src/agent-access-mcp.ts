import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  agentAccessEnvelopeSchema,
  getTriggerEventResultSchema,
  getWorkflowRunResultSchema,
  listTriggerEventsResultSchema,
  listWorkflowRunsResultSchema,
} from '@shipfox/api-agent-access-dto';
import {config, pollUntil} from '@shipfox/e2e-core';
import {authorizeAgentAccess} from '@shipfox/e2e-setup-auth';
import type {SuiteContext} from './suite-context.js';

const EVENT_PAGE_LIMIT = 10;
const MCP_POLL_INTERVAL_MS = 5_000;

type McpCall = Awaited<ReturnType<Client['callTool']>>;
type McpEnvelope = ReturnType<typeof agentAccessEnvelopeSchema.parse>;
type TriggerEventDetail = ReturnType<typeof getTriggerEventResultSchema.parse>;
type TriggerEventListItem = ReturnType<
  typeof listTriggerEventsResultSchema.parse
>['trigger_events'][number];

/**
 * Registers an agent-access OAuth client for the suite user and connects an MCP client
 * to the API, as a user's coding agent would.
 */
export async function connectAgentAccessMcp(params: {
  request: Parameters<typeof authorizeAgentAccess>[0]['request'];
  suite: SuiteContext;
  uniqueId: string;
  clientName: string;
}): Promise<Client> {
  const apiOrigin = new URL(config.API_URL).origin;
  const token = await authorizeAgentAccess({
    request: params.request,
    apiOrigin,
    publicOrigin: new URL(config.API_PUBLIC_URL).origin,
    sessionToken: params.suite.sessionToken,
    workspaceId: params.suite.workspaceId,
    clientName: `${params.clientName} ${params.uniqueId}`,
    redirectUri: `http://127.0.0.1:43123/${params.uniqueId}/oauth/callback`,
  });

  const client = new Client({name: `${params.clientName} E2E client`, version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', apiOrigin), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        origin: new URL(config.CLIENT_BASE_URL).origin,
      },
    },
  });
  try {
    await client.connect(transport as unknown as Transport);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<{call: McpCall; envelope: McpEnvelope}> {
  const call = await client.callTool({name, arguments: arguments_}, CallToolResultSchema);
  return {call, envelope: agentAccessEnvelopeSchema.parse(call.structuredContent)};
}

export async function getRuns(client: Client, projectId: string) {
  const response = await callTool(client, 'list_workflow_runs', {project_id: projectId});
  if (!response.envelope.ok) throw new Error('Runs list returned an MCP error');
  return listWorkflowRunsResultSchema.parse(response.envelope.result).runs;
}

export async function getRun(client: Client, runId: string) {
  const response = await callTool(client, 'get_workflow_run', {run_id: runId});
  if (!response.envelope.ok) throw new Error('Run lookup returned an MCP error');
  return getWorkflowRunResultSchema.parse(response.envelope.result);
}

export async function getTriggerEvent(client: Client, eventId: string) {
  const response = await callTool(client, 'get_trigger_event', {event_id: eventId});
  if (!response.envelope.ok) throw new Error('Trigger event lookup returned an MCP error');
  return getTriggerEventResultSchema.parse(response.envelope.result);
}

export async function waitForIntegrationEvent(params: {
  client: Client;
  source: string;
  event: string;
  repositoryFullName: string;
  after?: string;
  from: string;
  requireProcessed?: boolean;
  description: string;
  excludedIds?: Set<string>;
}): Promise<TriggerEventDetail> {
  const inspectedIds = new Set<string>();
  return await pollUntil(
    {
      timeoutMs: 60_000,
      intervalMs: MCP_POLL_INTERVAL_MS,
      maxIntervalMs: MCP_POLL_INTERVAL_MS,
      describe: () => params.description,
    },
    async () => {
      // Parallel tests push through the same connection, so the awaited event can sit
      // past the first page.
      let cursor: string | null = null;
      do {
        const response = await callTool(params.client, 'list_trigger_events', {
          source: [params.source],
          event: [params.event],
          origin: ['integration'],
          from: params.from,
          limit: EVENT_PAGE_LIMIT,
          ...(cursor === null ? {} : {cursor}),
        });
        if (!response.envelope.ok) throw new Error('Trigger event list returned an MCP error');
        const page = listTriggerEventsResultSchema.parse(response.envelope.result);
        const match = await findMatchingIntegrationEvent({
          ...params,
          events: page.trigger_events,
          inspectedIds,
        });
        if (match !== null) return match;
        cursor = page.next_cursor;
      } while (cursor !== null);
      return null;
    },
  );
}

async function findMatchingIntegrationEvent(params: {
  client: Client;
  events: TriggerEventListItem[];
  repositoryFullName: string;
  after?: string;
  requireProcessed?: boolean;
  excludedIds?: Set<string>;
  inspectedIds: Set<string>;
}): Promise<TriggerEventDetail | null> {
  for (const candidate of params.events) {
    const excluded = params.excludedIds?.has(candidate.id) ?? false;
    if (candidate.origin !== 'integration' || excluded || params.inspectedIds.has(candidate.id)) {
      continue;
    }
    const detail = await getTriggerEvent(params.client, candidate.id);
    if (!triggerEventMatches(detail, params)) {
      params.inspectedIds.add(candidate.id);
      continue;
    }
    if (!params.requireProcessed || detail.processed_at !== null) return detail;
  }
  return null;
}

function triggerEventMatches(
  detail: TriggerEventDetail,
  params: {repositoryFullName: string; after?: string},
): boolean {
  const payload = JSON.parse(detail.payload_preview) as unknown;
  const repositoryMatches =
    nestedString(payload, ['repository', 'full_name']) === params.repositoryFullName;
  const commitMatches =
    params.after === undefined || nestedString(payload, ['after']) === params.after;
  return repositoryMatches && commitMatches;
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}
