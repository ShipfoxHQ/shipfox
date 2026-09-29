import {RegistryUnavailableError} from './errors.js';

const REGISTRY_FETCH_TIMEOUT_MS = 15_000;

/** Fetches one registry API resource, following download redirects. Returns `undefined` on a 404. */
export async function fetchRegistryFile(params: {
  registry: string;
  path: string;
}): Promise<Uint8Array | undefined> {
  const response = await fetchRegistryResponse(params);
  if (response.status === 404) {
    await discardBody(response);
    return undefined;
  }
  return await readBody({response, path: params.path});
}

export type RegistryIndexFetch =
  | {status: 'ok'; body: Uint8Array; etag: string | null}
  | {status: 'not-modified'}
  | {status: 'not-found'};

/** Fetches a mutable index. With `etag`, the registry can answer that the stored copy is current. */
export async function fetchRegistryIndex(params: {
  registry: string;
  path: string;
  etag?: string | null | undefined;
}): Promise<RegistryIndexFetch> {
  const response = await fetchRegistryResponse({
    registry: params.registry,
    path: params.path,
    headers: params.etag ? {'if-none-match': params.etag} : {},
  });
  if (response.status === 304) {
    await discardBody(response);
    return {status: 'not-modified'};
  }
  if (response.status === 404) {
    await discardBody(response);
    return {status: 'not-found'};
  }
  const body = await readBody({response, path: params.path});
  return {status: 'ok', body, etag: response.headers.get('etag')};
}

async function fetchRegistryResponse(params: {
  registry: string;
  path: string;
  headers?: Record<string, string>;
}): Promise<Response> {
  const url = `${params.registry}${params.path}`;
  try {
    // Downloads answer 307 to a presigned URL. The request carries no credentials, so
    // the redirect leaks none.
    return await fetch(url, {
      redirect: 'follow',
      headers: params.headers ?? {},
      signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RegistryUnavailableError(`Could not reach the registry for ${params.path}`, {
      cause: error,
    });
  }
}

async function readBody(params: {response: Response; path: string}): Promise<Uint8Array> {
  const {response, path} = params;
  if (!response.ok) {
    await discardBody(response);
    throw new RegistryUnavailableError(`The registry answered ${response.status} for ${path}`);
  }
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new RegistryUnavailableError(`The registry response for ${path} was cut short`, {
      cause: error,
    });
  }
}

// Cancelling rejects when the connection died after the headers, which must not hide the status.
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}
