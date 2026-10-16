import {pollUntil} from '@shipfox/e2e-core';

export interface JamMockCall {
  kind: 'mcp';
  token: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

function jamMockUrl(path: string): URL {
  const base = process.env.JAM_API_BASE_URL;
  if (!base) throw new Error('JAM_API_BASE_URL must be configured for the Jam E2E mock.');
  return new URL(path, base);
}

/** The tool calls the fake received for a token, in order. */
export async function jamMockCalls(token: string): Promise<JamMockCall[]> {
  const response = await fetch(jamMockUrl(`/__e2e/calls?token=${encodeURIComponent(token)}`));
  if (!response.ok) throw new Error(`Jam mock calls failed with ${response.status}`);
  return (await response.json()) as JamMockCall[];
}

/** Every MCP request the fake received for a token, initialize included. */
export async function jamMockMcpRequestCount(token: string): Promise<number> {
  const response = await fetch(
    jamMockUrl(`/__e2e/mcp-request-count?token=${encodeURIComponent(token)}`),
  );
  if (!response.ok) throw new Error(`Jam mock MCP request count failed with ${response.status}`);
  const body = (await response.json()) as {count: number};
  return body.count;
}

export async function waitForJamMockCall(token: string): Promise<JamMockCall> {
  return await pollUntil(
    {
      timeoutMs: 30_000,
      intervalMs: 100,
      maxIntervalMs: 1_000,
      describe: () => `a Jam MCP call for ${token}`,
    },
    async () => (await jamMockCalls(token))[0] ?? null,
  );
}

/**
 * Makes the fake reject the token with HTTP 401, as Jam does for a revoked one. A token whose
 * value contains `revoked` is rejected from the start.
 */
export async function revokeJamToken(token: string): Promise<void> {
  await jamMockControl({revoke_token: token});
}

/**
 * Answers the calls the fake holds for a token whose value contains `stale`. They fail with
 * HTTP 401 when the token is revoked by then, and return their result otherwise.
 */
export async function releaseJamCall(token: string): Promise<void> {
  await jamMockControl({release_token: token});
}

async function jamMockControl(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(jamMockUrl('/__e2e/control'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Jam mock control failed with ${response.status}`);
}
