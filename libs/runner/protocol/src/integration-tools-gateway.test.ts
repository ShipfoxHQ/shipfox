import {AGENT_INTEGRATION_MCP_ENDPOINT} from '@shipfox/api-agent-dto';
import {
  createIntegrationToolsGatewayFetch,
  integrationToolsGatewayUrl,
} from '#integration-tools-gateway.js';

let calls: Array<{
  url: string;
  authorization: string | null;
  accept: string | null;
  redirect: RequestInit['redirect'];
}>;
let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  calls = [];
});

describe('integration tools gateway protocol helpers', () => {
  it('composes the configured API base URL with the integration MCP endpoint', () => {
    const url = integrationToolsGatewayUrl();

    expect(url.pathname).toBe(AGENT_INTEGRATION_MCP_ENDPOINT);
  });

  it('injects the current lease token on every gateway fetch', async () => {
    stubFetch();
    let leaseToken = 'lease-initial';
    const gatewayUrl = new URL('https://api.example.test/runs/jobs/current/integration-tools/mcp');
    const gatewayFetch = createIntegrationToolsGatewayFetch(() => leaseToken, gatewayUrl);

    await gatewayFetch('https://api.example.test/runs/jobs/current/integration-tools/mcp', {
      headers: {accept: 'application/json, text/event-stream'},
    });
    leaseToken = 'lease-next';
    await gatewayFetch(new URL('https://api.example.test/runs/jobs/current/integration-tools/mcp'));

    expect(calls).toEqual([
      {
        url: 'https://api.example.test/runs/jobs/current/integration-tools/mcp',
        authorization: 'Bearer lease-initial',
        accept: 'application/json, text/event-stream',
        redirect: 'error',
      },
      {
        url: 'https://api.example.test/runs/jobs/current/integration-tools/mcp',
        authorization: 'Bearer lease-next',
        accept: null,
        redirect: 'error',
      },
    ]);
  });

  it('refuses to attach the lease token to non-gateway requests', async () => {
    stubFetch();
    const gatewayUrl = new URL('https://api.example.test/runs/jobs/current/integration-tools/mcp');
    const gatewayFetch = createIntegrationToolsGatewayFetch('lease-current', gatewayUrl);

    await expect(gatewayFetch('https://api.example.test/runs/jobs/current')).rejects.toThrow(
      'Integration tools gateway fetch refused request to https://api.example.test/runs/jobs/current',
    );

    expect(calls).toEqual([]);
  });
});

function stubFetch(): void {
  globalThis.fetch = vi.fn((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push({
      url: request.url,
      authorization: request.headers.get('authorization'),
      accept: request.headers.get('accept'),
      redirect: request.redirect,
    });
    return Promise.resolve(new Response(null, {status: 202}));
  }) as unknown as typeof globalThis.fetch;
}
