import {RegistryUnavailableError} from './errors.js';

const REGISTRY_FETCH_TIMEOUT_MS = 15_000;

/** Fetches one public registry file. Returns `undefined` on a 404. */
export async function fetchRegistryFile(params: {
  registry: string;
  path: string;
}): Promise<Uint8Array | undefined> {
  const url = `${params.registry}/${params.path}`;
  let response: Response;
  try {
    response = await fetch(url, {signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS)});
  } catch (error) {
    throw new RegistryUnavailableError(`Could not reach the registry for ${params.path}`, {
      cause: error,
    });
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel();
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
