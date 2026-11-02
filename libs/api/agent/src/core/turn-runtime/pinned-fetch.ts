import {lookup as dnsLookup, type LookupAddress} from 'node:dns';
import {request as httpRequest, type IncomingMessage} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {Readable, type Transform} from 'node:stream';
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib';
import {assertEgressAllowed, type EgressPolicy} from '@shipfox/node-egress-guard';

export class PinnedFetchRedirectError extends Error {
  constructor(public readonly status: number) {
    super(`Custom model provider answered with a redirect (${status}), which is not followed`);
    this.name = 'PinnedFetchRedirectError';
  }
}

type Lookup = typeof dnsLookup;
type FetchInput = Parameters<typeof fetch>[0];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function addressUrl(record: LookupAddress): string {
  return record.family === 6 ? `http://[${record.address}]` : `http://${record.address}`;
}

/**
 * Resolves a host and checks every address it got, so the socket connects to an address this
 * check saw. A check before the request and a lookup inside the socket would let a changing DNS
 * answer pass the first and reach a private address with the second.
 */
function createPinnedLookup(policy: EgressPolicy, lookup: Lookup) {
  return ((hostname: string, options: {all?: boolean}, callback: (...args: unknown[]) => void) => {
    lookup(hostname, {all: true}, (error, records) => {
      if (error) return callback(error);
      Promise.all(records.map((record) => assertEgressAllowed(addressUrl(record), policy))).then(
        () => {
          const [first] = records;
          if (options.all) return callback(null, records);
          if (!first) return callback(new Error(`No address for ${hostname}`));
          return callback(null, first.address, first.family);
        },
        (denied: unknown) => callback(denied),
      );
    });
  }) as Lookup;
}

function decoderFor(encoding: string | undefined): Transform | undefined {
  switch (encoding?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      return undefined;
  }
}

async function readBody(input: FetchInput, init: RequestInit | undefined) {
  if (input instanceof Request) {
    // The init overrides the request, as it does in `fetch`.
    const request = init === undefined ? input : new Request(input, init);
    return {
      url: new URL(request.url),
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body === null ? undefined : Buffer.from(await request.arrayBuffer()),
      signal: request.signal,
    };
  }
  const body = init?.body;
  let bytes: Buffer | undefined;
  if (typeof body === 'string') bytes = Buffer.from(body, 'utf8');
  else if (body instanceof Uint8Array) bytes = Buffer.from(body);
  else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
  else if (body instanceof URLSearchParams) bytes = Buffer.from(body.toString(), 'utf8');
  else if (body !== undefined && body !== null) {
    throw new TypeError('The pinned fetch supports string and binary request bodies only');
  }
  return {
    url: new URL(input instanceof URL ? input.href : String(input)),
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    body: bytes,
    signal: init?.signal ?? undefined,
  };
}

function toResponse(incoming: IncomingMessage): Response {
  const status = incoming.statusCode ?? 502;
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  if (NULL_BODY_STATUSES.has(status)) {
    incoming.resume();
    return new Response(null, {status, statusText: incoming.statusMessage ?? '', headers});
  }
  const decoder = decoderFor(incoming.headers['content-encoding']);
  let source: Readable = incoming;
  if (decoder) {
    headers.delete('content-encoding');
    headers.delete('content-length');
    source = incoming.pipe(decoder);
    incoming.on('error', (error) => decoder.destroy(error));
  }
  return new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {
    status,
    statusText: incoming.statusMessage ?? '',
    headers,
  });
}

/**
 * A `fetch` for the API process to call a custom model provider with. It pins the address the
 * socket connects to, checks that address against the egress policy, and refuses redirects, so a
 * provider URL can't be turned toward the internal network by DNS changes or a `Location` header.
 */
export function createPinnedFetch(params: {policy: EgressPolicy; lookup?: Lookup | undefined}) {
  const lookup = params.lookup ?? dnsLookup;
  const pinnedLookup = createPinnedLookup(params.policy, lookup);
  const resolve = (hostname: string) =>
    new Promise<LookupAddress[]>((resolveRecords, reject) => {
      lookup(hostname, {all: true}, (error, records) =>
        error ? reject(error) : resolveRecords(records),
      );
    });

  return async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const {url, method, headers, body, signal} = await readBody(input, init);
    // Covers the scheme, the host denylist, and an IP literal, which skips the socket lookup.
    // The socket's own lookup then checks the address it connects to.
    await assertEgressAllowed(url.href, params.policy, {lookup: resolve});

    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return await new Promise<Response>((resolve, reject) => {
      const outgoing = requestFn(
        url,
        {
          method,
          headers: Object.fromEntries(headers.entries()),
          lookup: pinnedLookup,
          ...(signal ? {signal} : {}),
        },
        (incoming) => {
          if (REDIRECT_STATUSES.has(incoming.statusCode ?? 0)) {
            incoming.destroy();
            reject(new PinnedFetchRedirectError(incoming.statusCode ?? 0));
            return;
          }
          try {
            resolve(toResponse(incoming));
          } catch (error) {
            incoming.destroy();
            reject(error);
          }
        },
      );
      outgoing.on('upgrade', (_incoming, socket) => {
        socket.destroy();
        reject(
          new Error('Custom model provider answered with a protocol upgrade, which is refused'),
        );
      });
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  };
}
