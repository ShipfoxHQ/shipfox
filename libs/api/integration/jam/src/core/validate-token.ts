import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {JAM_TOKEN_PREFIX} from '@shipfox/api-integration-jam-dto';
import type {JamIntrospectionClient} from '#api/introspect.js';
import {
  JamIntegrationProviderError,
  JamInvalidTokenError,
  JamMcpUnavailableError,
  JamMissingReadScopeError,
  JamTokenPrefixError,
} from './errors.js';
import {
  type CreateJamMcpClient,
  createSdkJamMcpClient,
  DEFAULT_JAM_MCP_ENDPOINT,
  JAM_MCP_CALL_TIMEOUT_MS,
  type JamMcpClient,
  mapJamMcpError,
} from './mcp-client.js';

const MCP_READ_SCOPE = 'mcp:read';
const LIST_MEMBERS_PAGE_SIZE = 250;
const LIST_MEMBERS_MAX_PAGES = 20;

export interface ValidatedJamToken {
  teamId: string;
  userId: string;
  userName: string;
  userEmail: string | null;
}

export interface ValidateJamTokenParams {
  token: string;
  endpoint: URL;
  introspection: JamIntrospectionClient;
  createClient: CreateJamMcpClient;
  callTimeoutMs?: number | undefined;
}

export function createJamTokenValidator(options: {
  introspection: JamIntrospectionClient;
  endpoint?: string | URL | undefined;
  createClient?: CreateJamMcpClient | undefined;
}): (token: string) => Promise<ValidatedJamToken> {
  const endpoint = new URL(options.endpoint ?? DEFAULT_JAM_MCP_ENDPOINT);
  return (token) =>
    validateJamToken({
      token,
      endpoint,
      introspection: options.introspection,
      createClient: options.createClient ?? createSdkJamMcpClient,
    });
}

export function assertJamTokenPrefix(token: string): void {
  if (!token.startsWith(JAM_TOKEN_PREFIX)) throw new JamTokenPrefixError();
}

/**
 * Checks a Jam token before any credential is written. Introspection gives the Jam
 * workspace and user and rejects a CLI-only token. `listMembers` over the MCP names the user
 * and proves the token reaches the MCP and can call a read tool.
 */
export async function validateJamToken(params: ValidateJamTokenParams): Promise<ValidatedJamToken> {
  assertJamTokenPrefix(params.token);

  const introspected = await params.introspection.introspect(params.token);
  if (!introspected.active) throw new JamInvalidTokenError();
  if (!introspected.scopes.includes(MCP_READ_SCOPE)) throw new JamMissingReadScopeError();

  let client: JamMcpClient;
  try {
    client = await params.createClient({endpoint: params.endpoint, accessToken: params.token});
  } catch (error) {
    throw toValidationError(error);
  }
  try {
    const member = await findMember({
      client,
      userId: introspected.userId,
      timeoutMs: params.callTimeoutMs ?? JAM_MCP_CALL_TIMEOUT_MS,
    });
    return {
      teamId: introspected.teamId,
      userId: introspected.userId,
      userName: member.name,
      userEmail: member.email,
    };
  } catch (error) {
    throw toValidationError(error);
  } finally {
    await client.close().catch(() => undefined);
  }
}

interface JamMember {
  id: string;
  name: string;
  email: string | null;
}

async function findMember(params: {
  client: JamMcpClient;
  userId: string;
  timeoutMs: number;
}): Promise<JamMember> {
  // `after` is the ID of the last member of the previous page. Jam may return fewer members than
  // asked for, so a short page does not end the list; a page with no new member does.
  const seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < LIST_MEMBERS_MAX_PAGES; page++) {
    const result = await params.client.callTool(
      {
        toolId: 'listMembers',
        arguments: {limit: LIST_MEMBERS_PAGE_SIZE, ...(after === undefined ? {} : {after})},
      },
      params.timeoutMs,
    );
    if (result.isError === true) throw new JamMcpUnavailableError(resultText(result));

    const members = parseMembers(result);
    const member = members.find((candidate) => candidate.id === params.userId);
    if (member) return member;

    const last = members.at(-1);
    const unseen = members.filter((candidate) => !seen.has(candidate.id));
    if (last === undefined || unseen.length === 0) break;
    for (const candidate of unseen) seen.add(candidate.id);
    after = last.id;
  }
  throw new JamMcpUnavailableError('The token user is not a member of the Jam workspace.');
}

function parseMembers(result: CallToolResult): JamMember[] {
  let payload: unknown;
  try {
    payload = JSON.parse(resultText(result));
  } catch {
    throw new JamMcpUnavailableError('Jam returned an unreadable member list.');
  }
  const users =
    typeof payload === 'object' && payload !== null && 'users' in payload ? payload.users : null;
  if (!Array.isArray(users)) {
    throw new JamMcpUnavailableError('Jam returned an unreadable member list.');
  }
  return users.flatMap((user) => {
    const member = toMember(user);
    return member ? [member] : [];
  });
}

function toMember(user: unknown): JamMember | undefined {
  if (typeof user !== 'object' || user === null) return undefined;
  const {id, name, email} = user as Record<string, unknown>;
  if (typeof id !== 'string') return undefined;
  return {
    id,
    name: typeof name === 'string' && name !== '' ? name : id,
    email: typeof email === 'string' && email !== '' ? email : null,
  };
}

function resultText(result: CallToolResult): string {
  return result.content
    .filter((item): item is {type: 'text'; text: string} => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

function toValidationError(error: unknown): unknown {
  if (error instanceof JamMcpUnavailableError) return error;
  const mapped = mapJamMcpError(error);
  if (mapped instanceof JamIntegrationProviderError) {
    if (mapped.status === 401) return new JamInvalidTokenError();
    if (mapped.reason === 'provider-rejected') return new JamMcpUnavailableError(mapped.message);
  }
  return mapped;
}
