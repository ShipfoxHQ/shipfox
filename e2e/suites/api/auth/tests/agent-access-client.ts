import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import {config} from '@shipfox/e2e-core';
import {
  type AuthHelper,
  authorizeAgentAccess,
  registerAgentAccessClient,
} from '@shipfox/e2e-setup-auth';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import type {APIRequestContext} from '@shipfox/playwright';

export interface AgentAccessSession {
  client: Client;
  userId: string;
  workspaceId: string;
}

const CLIENT_NAME = 'Agent Access Tools E2E Client';
const REDIRECT_URI = 'http://127.0.0.1:43200/oauth/callback';

// OAuth registration allows 10 clients per IP per hour, so each worker registers once and
// authorizes every grant it needs with that client.
let registeredClientId: Promise<string> | undefined;

/** Creates a user, a workspace, and an Agent Access grant, then connects an MCP client with it. */
export async function connectAgentAccessClient(params: {
  request: APIRequestContext;
  auth: AuthHelper;
}): Promise<AgentAccessSession> {
  const apiOrigin = new URL(config.API_URL).origin;
  registeredClientId ??= registerAgentAccessClient({
    request: params.request,
    apiOrigin,
    clientName: CLIENT_NAME,
    redirectUri: REDIRECT_URI,
  });
  const clientId = await registeredClientId;
  const user = await params.auth.createUser();
  const session = await params.auth.createSession({user_id: user.user.id});
  const workspace = await createWorkspace({userId: user.user.id, userEmail: user.email});
  const token = await authorizeAgentAccess({
    request: params.request,
    apiOrigin,
    publicOrigin: new URL(config.API_PUBLIC_URL).origin,
    sessionToken: session.token,
    workspaceId: workspace.id,
    clientName: CLIENT_NAME,
    redirectUri: REDIRECT_URI,
    clientId,
  });
  const client = new Client({name: CLIENT_NAME, version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', apiOrigin), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        origin: new URL(config.CLIENT_BASE_URL).origin,
      },
    },
  });
  await client.connect(transport as unknown as Transport);
  return {client, userId: user.user.id, workspaceId: workspace.id};
}

/** Calls a tool and parses its successful result, failing with the envelope otherwise. */
export async function callToolResult<Result>(
  client: Client,
  call: {name: string; arguments: Record<string, unknown>},
  schema: {parse(input: unknown): Result},
): Promise<Result> {
  const envelope = await callToolEnvelope(client, call);
  if (!envelope.ok) {
    throw new Error(`${call.name} returned ${JSON.stringify(envelope.error)}`);
  }
  return schema.parse(envelope.result);
}

export async function callToolEnvelope(
  client: Client,
  call: {name: string; arguments: Record<string, unknown>},
) {
  const result = await client.callTool(call, CallToolResultSchema);
  return agentAccessEnvelopeSchema.parse(result.structuredContent);
}
