import {
  AUTH_LEASED_JOB,
  type LeasedJobContext,
  setLeasedJobContext,
} from '@shipfox/api-auth-context';
import {
  type AgentToolDownloadFileInput,
  type AgentToolFileDownload,
  MAX_AGENT_TOOL_FILE_BYTES,
} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {IntegrationProviderError} from '#core/errors.js';
import {
  catalogTool,
  connection,
  leaseContext,
  materializedIntegration,
  materializedTool,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {createAgentToolsGatewayRoutes} from './index.js';
import type {LeasedIntegrationConfig} from './resolve-authorized-tools.js';

const DOWNLOAD_URL = '/runs/jobs/current/integration-tools/download';
const LEASE_TOKEN = 'action-lease';

let lease: LeasedJobContext;

const fakeLeaseAuth: AuthMethod = {
  name: AUTH_LEASED_JOB,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== `Bearer ${LEASE_TOKEN}`) {
      throw new ClientError('Invalid job lease token', 'unauthorized', {status: 401});
    }
    setLeasedJobContext(request, lease);
    return Promise.resolve();
  },
};

type DownloadFile = (input: AgentToolDownloadFileInput) => Promise<AgentToolFileDownload>;

describe('tool download route', () => {
  beforeEach(async () => {
    await closeApp();
    lease = leaseContext({workspaceId: 'workspace-1'});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeApp();
  });

  it('streams a granted file with its metadata and audits the byte count', async () => {
    const infoSpy = vi.spyOn(logger(), 'info');
    const downloadFile = vi.fn<DownloadFile>(async () =>
      fileDownload([Buffer.from('hello '), Buffer.from('world')], {
        mediaType: 'text/plain; charset=utf-8',
        filename: "résumé (v2)'s.txt",
        size: 11,
      }),
    );
    const address = await startGateway({downloadFile});

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {url: 'u'}},
      headers: {'x-shipfox-call-id': 'call-1'},
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('x-shipfox-filename')).toBe(
      "UTF-8''r%C3%A9sum%C3%A9%20%28v2%29%27s.txt",
    );
    expect(res.headers.get('x-shipfox-size')).toBe('11');
    expect(await res.text()).toBe('hello world');
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({toolId: 'download_file', arguments: {url: 'u'}}),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: 'action',
        callId: 'call-1',
        toolId: 'download_file',
        outcome: 'success',
        resultKind: 'file',
        bytes: 11,
      }),
      'integration tool call audited',
    );
  });

  it('refuses a tool the action was not granted without calling the provider', async () => {
    const downloadFile = vi.fn<DownloadFile>();
    const address = await startGateway({downloadFile});

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'other_file', arguments: {}},
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'invalid-request',
      details: {reason: 'tool_not_found', tool: 'other_file'},
    });
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('refuses a granted tool that returns JSON', async () => {
    const downloadFile = vi.fn<DownloadFile>();
    const address = await startGateway({
      downloadFile,
      integrations: [materializedIntegration({connectionId: 'connection-1'})],
    });

    const res = await download(address, {
      body: {
        connection_slug: 'github-main',
        tool: 'issue_read',
        arguments: {method: 'get'},
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'invalid-request',
      details: {reason: 'result_kind_mismatch'},
    });
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('refuses leased agent steps', async () => {
    const downloadFile = vi.fn<DownloadFile>();
    const address = await startGateway({downloadFile, stepType: 'agent'});

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {}},
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({code: 'leased-step-not-action'});
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('requires lease auth', async () => {
    const address = await startGateway({downloadFile: vi.fn<DownloadFile>()});

    const res = await fetch(new URL(DOWNLOAD_URL, address), {method: 'POST'});

    expect(res.status).toBe(401);
  });

  it('returns provider errors before any byte is sent', async () => {
    const address = await startGateway({
      downloadFile: () =>
        Promise.reject(
          new IntegrationProviderError('file-location-not-allowed', 'Not a Linear upload URL'),
        ),
    });

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {url: 'x'}},
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'file-location-not-allowed',
      details: {message: 'Not a Linear upload URL'},
    });
  });

  it('refuses a file whose announced size exceeds the limit', async () => {
    const cancel = vi.fn();
    const address = await startGateway({
      downloadFile: async () => ({
        ...fileDownload([Buffer.from('x')], {size: MAX_AGENT_TOOL_FILE_BYTES + 1}),
        body: new ReadableStream({cancel}),
      }),
    });

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {}},
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({code: 'file-too-large'});
    expect(cancel).toHaveBeenCalled();
  });

  it('cuts the stream once the file exceeds the limit', async () => {
    const infoSpy = vi.spyOn(logger(), 'info');
    const chunk = Buffer.alloc(1024 * 1024);
    let providerSignal: AbortSignal | undefined;
    const address = await startGateway({
      downloadFile: (input) => {
        providerSignal = input.signal;
        let sent = 0;
        return Promise.resolve({
          mediaType: 'application/octet-stream',
          body: new ReadableStream<Uint8Array>({
            pull(controller) {
              sent += 1;
              controller.enqueue(chunk);
              if (sent > 200) controller.close();
            },
          }),
        });
      },
    });

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {}},
    });

    expect(res.status).toBe(200);
    await expect(readAll(res)).rejects.toThrow();
    await vi.waitFor(() =>
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({outcome: 'tool-error', errorCode: 'file-too-large'}),
        'integration tool call audited',
      ),
    );
    expect(providerSignal?.aborted).toBe(true);
  });

  it('fails with a timeout when the deadline passes before the provider answers', async () => {
    let providerSignal: AbortSignal | undefined;
    const address = await startGateway({
      downloadFile: (input) => {
        providerSignal = input.signal;
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), {once: true});
        });
      },
    });

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {}},
      headers: {'x-shipfox-deadline': '50'},
    });

    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({code: 'provider-timeout'});
    expect(providerSignal?.reason).toMatchObject({name: 'TimeoutError'});
  });

  it('cuts a stalled stream at the deadline', async () => {
    const infoSpy = vi.spyOn(logger(), 'info');
    const cancel = vi.fn();
    const address = await startGateway({
      downloadFile: async () => ({
        mediaType: 'application/octet-stream',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from('partial'));
          },
          cancel,
        }),
      }),
    });

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {}},
      headers: {'x-shipfox-deadline': '100'},
    });

    await expect(readAll(res)).rejects.toThrow();
    await vi.waitFor(() =>
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({outcome: 'tool-error', errorCode: 'provider-timeout', bytes: 7}),
        'integration tool call audited',
      ),
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('aborts the provider transfer when the runner disconnects', async () => {
    const infoSpy = vi.spyOn(logger(), 'info');
    let providerSignal: AbortSignal | undefined;
    let markCancelled: () => void = () => undefined;
    const cancelled = new Promise<void>((resolve) => {
      markCancelled = resolve;
    });
    const address = await startGateway({
      downloadFile: (input) => {
        providerSignal = input.signal;
        return Promise.resolve({
          mediaType: 'application/octet-stream',
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Buffer.from('first chunk'));
            },
            cancel: () => markCancelled(),
          }),
        });
      },
    });
    const runner = new AbortController();

    const res = await download(address, {
      body: {connection_slug: 'github-main', tool: 'download_file', arguments: {}},
      signal: runner.signal,
    });
    const reader = res.body?.getReader();
    await reader?.read();
    runner.abort();

    await cancelled;
    expect(providerSignal?.aborted).toBe(true);
    expect(providerSignal?.reason).toMatchObject({name: 'AbortError'});
    await vi.waitFor(() =>
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({outcome: 'tool-error', errorCode: 'cancelled'}),
        'integration tool call audited',
      ),
    );
  });
});

async function startGateway(params: {
  downloadFile: DownloadFile;
  stepType?: 'agent' | 'action';
  integrations?: LeasedIntegrationConfig[];
}): Promise<string> {
  const integrations = params.integrations ?? [fileIntegration()];
  const app = await createApp({
    auth: [fakeLeaseAuth],
    routes: [
      createAgentToolsGatewayRoutes({
        registry: registryWithAgentTools([catalogTool(), fileCatalogTool()], {
          downloadFile: params.downloadFile,
        }),
        getIntegrationConnectionById: async (id) =>
          connection({id, workspaceId: lease.workspaceId, slug: 'github-main'}),
        loadLeasedAgentStep: async () => ({
          workspaceId: lease.workspaceId,
          stepType: params.stepType ?? 'action',
          integrations,
        }),
      }),
    ],
    swagger: false,
  });
  await app.ready();
  return await app.listen({port: 0, host: '127.0.0.1'});
}

function download(
  address: string,
  params: {body: unknown; headers?: Record<string, string>; signal?: AbortSignal},
): Promise<Response> {
  return fetch(new URL(DOWNLOAD_URL, address), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${LEASE_TOKEN}`,
      'content-type': 'application/json',
      ...params.headers,
    },
    body: JSON.stringify(params.body),
    ...(params.signal === undefined ? {} : {signal: params.signal}),
  });
}

async function readAll(res: Response): Promise<number> {
  const reader = res.body?.getReader();
  let bytes = 0;
  while (true) {
    const chunk = await reader?.read();
    if (!chunk || chunk.done) return bytes;
    bytes += chunk.value.byteLength;
  }
}

function fileCatalogTool() {
  return catalogTool({
    id: 'download_file',
    description: 'Download a file.',
    result: 'file',
    inputSchema: {type: 'object', properties: {url: {type: 'string'}}},
    outputSchema: undefined,
    methods: undefined,
  });
}

function fileIntegration(): LeasedIntegrationConfig {
  const {methods: _methods, ...tool} = materializedTool({
    id: 'download_file',
    inputSchema: {type: 'object', properties: {url: {type: 'string'}}},
  });
  return {
    ...materializedIntegration({connectionId: 'connection-1'}),
    tools: [{...tool, result: 'file'}],
  };
}

function fileDownload(
  chunks: Uint8Array[],
  overrides: Partial<Omit<AgentToolFileDownload, 'body'>> = {},
): AgentToolFileDownload {
  return {
    mediaType: 'application/octet-stream',
    ...overrides,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}
