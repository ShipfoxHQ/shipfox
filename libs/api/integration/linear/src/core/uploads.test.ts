import {MAX_AGENT_TOOL_FILE_BYTES} from '@shipfox/api-integration-spi';
import {assertEgressAllowed, EgressDeniedError} from '@shipfox/node-egress-guard';
import {LinearIntegrationProviderError} from '#core/errors.js';
import {downloadLinearUpload} from '#core/uploads.js';

vi.mock('@shipfox/node-egress-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-egress-guard')>()),
  assertEgressAllowed: vi.fn(),
}));

const assertEgressAllowedMock = vi.mocked(assertEgressAllowed);
const uploadsUrl = new URL('https://uploads.linear.app/');
const fileUrl = 'https://uploads.linear.app/org-1/file-1/file-2';

interface FetchCall {
  url: string;
  authorization: string | null;
  redirect: RequestInit['redirect'];
}

function fakeFetch(responses: Response[]) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      redirect: init?.redirect,
    });
    const response = responses.shift();
    return response === undefined
      ? Promise.reject(new Error('Unexpected fetch'))
      : Promise.resolve(response);
  });
  return {calls, fetch: fetch as unknown as typeof globalThis.fetch};
}

function redirect(location: string, status = 302): Response {
  return new Response(null, {status, headers: {location}});
}

function download(params: {url: unknown; fetch: typeof globalThis.fetch}) {
  return downloadLinearUpload({
    url: params.url,
    uploadsUrl,
    accessToken: 'linear-token',
    egressPolicy: {allowPrivateNetworks: false},
    signal: new AbortController().signal,
    fetch: params.fetch,
  });
}

async function rejection(promise: Promise<unknown>): Promise<LinearIntegrationProviderError> {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(error instanceof LinearIntegrationProviderError)) {
    throw new Error(`Expected a Linear provider error, got ${String(error)}`);
  }
  return error;
}

describe('downloadLinearUpload', () => {
  beforeEach(() => {
    assertEgressAllowedMock.mockReset();
    assertEgressAllowedMock.mockResolvedValue(undefined);
  });

  it('streams the file with its media type, name, and size', async () => {
    const {calls, fetch} = fakeFetch([
      new Response('file bytes', {
        headers: {
          'content-type': 'application/pdf',
          'content-length': '10',
          'content-disposition': `attachment; filename="plan.pdf"; filename*=UTF-8''pl%C3%A0n.pdf`,
        },
      }),
    ]);

    const file = await download({url: fileUrl, fetch});

    expect(await new Response(file.body).text()).toBe('file bytes');
    expect(file).toMatchObject({mediaType: 'application/pdf', filename: 'plàn.pdf', size: 10});
    expect(calls).toEqual([
      {url: fileUrl, authorization: 'Bearer linear-token', redirect: 'manual'},
    ]);
  });

  it('drops the signature and fetches with the bearer token instead', async () => {
    const {calls, fetch} = fakeFetch([new Response('x')]);

    await download({url: `${fileUrl}?signature=eyJ.jwt.sig&keep=1`, fetch});

    expect(calls[0]?.url).toBe(`${fileUrl}?keep=1`);
  });

  it('reads a plain quoted file name', async () => {
    const {fetch} = fakeFetch([
      new Response(new Uint8Array([1]), {
        headers: {'content-disposition': 'inline; filename="a \\"b\\".txt"'},
      }),
    ]);

    const file = await download({url: fileUrl, fetch});

    expect(file.filename).toBe('a "b".txt');
    expect(file.mediaType).toBe('application/octet-stream');
  });

  it.each([
    ['another host', 'https://example.com/org-1/file-1'],
    ['a look-alike host', 'https://uploads.linear.app.example.com/file'],
    ['plain HTTP', 'http://uploads.linear.app/org-1/file-1'],
    ['credentials in the URL', 'https://user@uploads.linear.app/org-1/file-1'],
    ['a relative path', '/org-1/file-1'],
    ['a non-string', 42],
  ])('rejects %s before fetching', async (_name, url) => {
    const {fetch} = fakeFetch([]);

    const error = await rejection(download({url, fetch}));

    expect(error.reason).toBe('file-location-not-allowed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the token on a same-origin redirect and drops it after an origin change', async () => {
    const {calls, fetch} = fakeFetch([
      redirect('/org-1/file-1/moved', 307),
      redirect('https://cdn.example.com/blob'),
      redirect('https://uploads.linear.app/org-1/back'),
      new Response('x'),
    ]);

    await download({url: fileUrl, fetch});

    expect(calls).toEqual([
      {url: fileUrl, authorization: 'Bearer linear-token', redirect: 'manual'},
      {
        url: 'https://uploads.linear.app/org-1/file-1/moved',
        authorization: 'Bearer linear-token',
        redirect: 'manual',
      },
      {url: 'https://cdn.example.com/blob', authorization: null, redirect: 'manual'},
      {url: 'https://uploads.linear.app/org-1/back', authorization: null, redirect: 'manual'},
    ]);
    expect(assertEgressAllowedMock).toHaveBeenCalledTimes(4);
  });

  it('stops after three redirects', async () => {
    const {fetch} = fakeFetch([
      redirect('/1'),
      redirect('/2'),
      redirect('/3'),
      redirect('/4'),
      new Response('x'),
    ]);

    const error = await rejection(download({url: fileUrl, fetch}));

    expect(error.reason).toBe('provider-rejected');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('refuses a redirect to plain HTTP', async () => {
    const {fetch} = fakeFetch([redirect('http://cdn.example.com/blob')]);

    const error = await rejection(download({url: fileUrl, fetch}));

    expect(error.reason).toBe('file-location-not-allowed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a network the egress guard denies', async () => {
    assertEgressAllowedMock.mockImplementation((url) =>
      new URL(url).hostname === 'internal.example.com'
        ? Promise.reject(new EgressDeniedError('private-network', '10.0.0.1'))
        : Promise.resolve(),
    );
    const {fetch} = fakeFetch([redirect('https://internal.example.com/blob')]);

    const error = await rejection(download({url: fileUrl, fetch}));

    expect(error.reason).toBe('file-location-not-allowed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect without a location', async () => {
    const {fetch} = fakeFetch([new Response(null, {status: 302})]);

    const error = await rejection(download({url: fileUrl, fetch}));

    expect(error.reason).toBe('malformed-provider-response');
  });

  it.each([
    String(MAX_AGENT_TOOL_FILE_BYTES + 1),
    '99999999999999999999',
  ])('rejects a file that announces a size of %s bytes', async (length) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({cancel});
    const {fetch} = fakeFetch([new Response(body, {headers: {'content-length': length}})]);

    const error = await rejection(download({url: fileUrl, fetch}));

    expect(error.reason).toBe('file-too-large');
    expect(cancel).toHaveBeenCalled();
  });

  it.each([
    [401, 'credentials-unavailable'],
    [403, 'access-denied'],
    [404, 'file-not-found'],
    [429, 'rate-limited'],
    [400, 'provider-rejected'],
    [503, 'provider-unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const {fetch} = fakeFetch([
      new Response('{"error":"nope"}', {status, headers: {'retry-after': '7'}}),
    ]);

    const error = await rejection(download({url: fileUrl, fetch}));

    expect(error.reason).toBe(reason);
    expect(error.status).toBe(status);
    expect(error.retryAfterSeconds).toBe(status === 429 ? 7 : undefined);
  });
});
