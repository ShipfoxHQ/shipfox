import {AGENT_INTEGRATION_MCP_ENDPOINT} from '@shipfox/api-agent-dto';
import {
  createIntegrationToolsDownload,
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

  it('posts a download to the gateway download route with the lease token', async () => {
    let request: Request | undefined;
    globalThis.fetch = vi.fn((input: Request | string | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(new Response('bytes'));
    }) as unknown as typeof globalThis.fetch;
    const download = createIntegrationToolsDownload(() => 'lease-current');

    const response = await download(
      {connectionSlug: 'acme-linear', tool: 'download_file', arguments: {url: 'u'}},
      {signal: new AbortController().signal, headers: {'x-shipfox-call-id': 'call-1'}},
    );

    expect(await response.text()).toBe('bytes');
    expect(new URL(request?.url ?? '').pathname).toBe(
      '/runs/jobs/current/integration-tools/download',
    );
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.headers.get('authorization')).toBe('Bearer lease-current');
    expect(request?.headers.get('x-shipfox-call-id')).toBe('call-1');
    expect(request?.redirect).toBe('error');
    expect(await request?.json()).toEqual({
      connection_slug: 'acme-linear',
      tool: 'download_file',
      arguments: {url: 'u'},
    });
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
