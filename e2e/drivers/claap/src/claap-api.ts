import {pollUntil} from '@shipfox/e2e-core';

export interface ClaapMockCall {
  kind: 'mcp';
  api_key: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

// The fake serves its MCP and its `/__e2e` routes on the same port.
function claapMockUrl(path: string): URL {
  const endpoint = process.env.CLAAP_MCP_ENDPOINT;
  if (!endpoint) throw new Error('CLAAP_MCP_ENDPOINT must be configured for the Claap E2E mock.');
  return new URL(path, endpoint);
}

/** The tool calls the fake received for a key, in order. */
export async function claapMockCalls(apiKey: string): Promise<ClaapMockCall[]> {
  const response = await fetch(claapMockUrl(`/__e2e/calls?api_key=${encodeURIComponent(apiKey)}`));
  if (!response.ok) throw new Error(`Claap mock calls failed with ${response.status}`);
  return (await response.json()) as ClaapMockCall[];
}

/** Every MCP request the fake received for a key, initialize included. */
export async function claapMockMcpRequestCount(apiKey: string): Promise<number> {
  const response = await fetch(
    claapMockUrl(`/__e2e/mcp-request-count?api_key=${encodeURIComponent(apiKey)}`),
  );
  if (!response.ok) throw new Error(`Claap mock MCP request count failed with ${response.status}`);
  const body = (await response.json()) as {count: number};
  return body.count;
}

export async function waitForClaapMockCall(apiKey: string): Promise<ClaapMockCall> {
  return await pollUntil(
    {
      timeoutMs: 30_000,
      intervalMs: 100,
      maxIntervalMs: 1_000,
      describe: () => `a Claap MCP call for ${apiKey}`,
    },
    async () => (await claapMockCalls(apiKey))[0] ?? null,
  );
}

/** One recording a seed puts in a key's workspace. */
export interface ClaapMockRecording {
  recordingId: string;
  title: string;
  /** The share URL, `https://app.claap.io/<slug>-c-<workspaceId>-<recordingId>`. */
  url: string;
  /** The creation date, `YYYY-MM-DD`. */
  createdAt: string;
  /** One line per speaker turn. The speakers become the recording's people. */
  transcript: Array<{speaker: string; text: string}>;
  /** Left out when Claap has not summarized the recording. */
  summary?: {markdown: string; state: string} | undefined;
}

/** What a key's seed makes the fake answer: its Claap workspace and the recordings in it. */
export interface ClaapMockSeed {
  workspace: {workspaceId: string; name: string};
  recordings: ClaapMockRecording[];
}

/**
 * Gives a key its Claap workspace and recordings, in place of an earlier seed. The fake rejects
 * a key without a seed with HTTP 401, as Claap rejects a key it does not know.
 */
export async function seedClaapMock({
  apiKey,
  seed,
}: {
  apiKey: string;
  seed: ClaapMockSeed;
}): Promise<void> {
  await claapMockPost('/__e2e/seed', {api_key: apiKey, ...seed});
}

/**
 * Makes the fake reject the key with HTTP 401 on every request, as Claap does for a revoked key.
 * A key whose value contains `revoked` is rejected from the start.
 */
export async function revokeClaapKey(apiKey: string): Promise<void> {
  await claapMockPost('/__e2e/control', {revoke_api_key: apiKey});
}

/**
 * Answers the calls the fake holds for a key whose value contains `stale`. They fail with HTTP 401
 * when the key is revoked by then, and return their result otherwise.
 */
export async function releaseClaapCall(apiKey: string): Promise<void> {
  await claapMockPost('/__e2e/control', {release_api_key: apiKey});
}

async function claapMockPost(path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(claapMockUrl(path), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Claap mock ${path} failed with ${response.status}`);
}
