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

export async function setPosthogProbeStatus(apiKey: string, status: number): Promise<void> {
  await posthogMockControl({api_key: apiKey, probe_status: status});
}

export async function releasePosthogCall(apiKey: string): Promise<void> {
  await posthogMockControl({release_api_key: apiKey});
}

async function posthogMockControl(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(posthogMockUrl('/__e2e/control'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PostHog mock control failed with ${response.status}`);
}
