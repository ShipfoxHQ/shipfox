import {pollUntil} from '@shipfox/e2e-core';

export interface PosthogMockCall {
  kind: 'mcp';
  api_key: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  headers: Record<string, string | undefined>;
}

function posthogMockUrl(path: string): URL {
  const base = process.env.POSTHOG_API_BASE_URL;
  if (!base) throw new Error('POSTHOG_API_BASE_URL must be configured for the PostHog E2E mock.');
  return new URL(path, base);
}

export async function posthogMockCalls(apiKey: string): Promise<PosthogMockCall[]> {
  const response = await fetch(
    posthogMockUrl(`/__e2e/calls?api_key=${encodeURIComponent(apiKey)}`),
  );
  if (!response.ok) throw new Error(`PostHog mock calls failed with ${response.status}`);
  return (await response.json()) as PosthogMockCall[];
}

export async function posthogMockMcpRequestCount(apiKey: string): Promise<number> {
  const response = await fetch(
    posthogMockUrl(`/__e2e/mcp-request-count?api_key=${encodeURIComponent(apiKey)}`),
  );
  if (!response.ok)
    throw new Error(`PostHog mock MCP request count failed with ${response.status}`);
  const body = (await response.json()) as {count: number};
  return body.count;
}

export async function waitForPosthogMockCall(apiKey: string): Promise<PosthogMockCall> {
  return await pollUntil(
    {
      timeoutMs: 30_000,
      intervalMs: 100,
      maxIntervalMs: 1_000,
      describe: () => `a PostHog MCP call for ${apiKey}`,
    },
    async () => (await posthogMockCalls(apiKey))[0] ?? null,
  );
}

/** What a key's seed makes the fake answer with, as the sandbox fixtures describe it. */
export interface PosthogMockSeed {
  /** Events the SQL tool can count, by `event` name. */
  events: Array<{name: string; count: number}>;
  feature_flags: Array<{id: number; key: string; name?: string; active?: boolean}>;
}

/**
 * Makes the fake answer `execute-sql` and `feature-flag-get-all` for a key with the results of
 * the seed. A key without a seed keeps the marker answers.
 */
export async function seedPosthogMock({
  apiKey,
  seed,
}: {
  apiKey: string;
  seed: PosthogMockSeed;
}): Promise<void> {
  await posthogMockControl({api_key: apiKey, ...seed}, '/__e2e/seed');
}

export async function setPosthogProbeStatus(apiKey: string, status: number): Promise<void> {
  await posthogMockControl({api_key: apiKey, probe_status: status});
}

export async function releasePosthogCall(apiKey: string): Promise<void> {
  await posthogMockControl({release_api_key: apiKey});
}

async function posthogMockControl(
  body: Record<string, unknown>,
  path = '/__e2e/control',
): Promise<void> {
  const response = await fetch(posthogMockUrl(path), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PostHog mock ${path} failed with ${response.status}`);
}
