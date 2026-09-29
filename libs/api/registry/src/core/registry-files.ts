import {RegistryUnavailableError} from './errors.js';

const REGISTRY_FETCH_TIMEOUT_MS = 15_000;

/** Fetches one registry API resource, following download redirects. Returns `undefined` on a 404. */
export async function fetchRegistryFile(params: {
  registry: string;
  path: string;
}): Promise<Uint8Array | undefined> {
  const url = `${params.registry}${params.path}`;
  let response: Response;
  try {
    // Downloads answer 307 to a presigned URL. The request carries no credentials, so
    // the redirect leaks none.
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RegistryUnavailableError(`Could not reach the registry for ${params.path}`, {
      cause: error,
    });
  }
  if (response.status === 404) {
    await discardBody(response);
    return undefined;
  }
  if (!response.ok) {
    await discardBody(response);
    throw new RegistryUnavailableError(
      `The registry answered ${response.status} for ${params.path}`,
    );
  }
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new RegistryUnavailableError(`The registry response for ${params.path} was cut short`, {
      cause: error,
    });
  }
}

// Cancelling rejects when the connection died after the headers, which must not hide the status.
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}
