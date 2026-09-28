import {type AgentToolFileDownload, MAX_AGENT_TOOL_FILE_BYTES} from '@shipfox/api-integration-spi';
import {
  assertEgressAllowed,
  EgressDeniedError,
  type EgressPolicy,
} from '@shipfox/node-egress-guard';
import {LinearIntegrationProviderError} from '#core/errors.js';

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DIGITS_PATTERN = /^\d+$/;
const EXTENDED_FILENAME_PATTERN = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;\s]+)/i;
const QUOTED_FILENAME_PATTERN = /(?:^|;)\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i;
const TOKEN_FILENAME_PATTERN = /(?:^|;)\s*filename\s*=\s*([^";\s]+)/i;
const QUOTED_PAIR_PATTERN = /\\(.)/g;

export interface DownloadLinearUploadParams {
  url: unknown;
  uploadsUrl: URL;
  accessToken: string;
  egressPolicy: EgressPolicy;
  signal: AbortSignal;
  fetch?: typeof fetch | undefined;
}

/**
 * Fetches a Linear upload with the connection's token. The token only goes to the
 * uploads origin: redirects are followed by hand and drop it once the origin changes.
 */
export async function downloadLinearUpload(
  params: DownloadLinearUploadParams,
): Promise<AgentToolFileDownload> {
  const fetchFn = params.fetch ?? fetch;
  let target = uploadUrl(params.url, params.uploadsUrl);
  let authorization: string | undefined = `Bearer ${params.accessToken}`;

  for (let redirects = 0; ; redirects++) {
    await assertLocationAllowed(target, params.egressPolicy);
    const response = await fetchFn(target, {
      redirect: 'manual',
      headers: authorization === undefined ? {} : {authorization},
      signal: params.signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return fileDownload(response);

    await response.body?.cancel().catch(() => undefined);
    if (redirects === MAX_REDIRECTS) {
      throw new LinearIntegrationProviderError(
        'provider-rejected',
        'Linear redirected the download too many times.',
        undefined,
        response.status,
      );
    }
    const next = redirectTarget(response, target);
    if (next.origin !== target.origin) authorization = undefined;
    target = next;
  }
}

/** Linear signs upload URLs for 5 minutes; the bearer token makes the signature unnecessary. */
function uploadUrl(value: unknown, uploadsUrl: URL): URL {
  const prefix = uploadsUrl.href;
  const parsed = typeof value === 'string' && value.startsWith(prefix) ? parseUrl(value) : null;
  if (
    parsed === null ||
    parsed.origin !== uploadsUrl.origin ||
    !parsed.pathname.startsWith(uploadsUrl.pathname) ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw locationNotAllowed(`The URL must start with ${prefix}.`);
  }
  parsed.searchParams.delete('signature');
  parsed.hash = '';
  return parsed;
}

function redirectTarget(response: Response, current: URL): URL {
  const location = response.headers.get('location');
  const next = location === null ? null : parseUrl(location, current);
  if (next === null) {
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear redirected the download without a valid location.',
      undefined,
      response.status,
    );
  }
  if (next.protocol !== 'https:') {
    throw locationNotAllowed('Linear redirected the download to a non-HTTPS location.');
  }
  return next;
}

async function assertLocationAllowed(target: URL, policy: EgressPolicy): Promise<void> {
  try {
    await assertEgressAllowed(target.href, policy);
  } catch (error) {
    if (error instanceof EgressDeniedError) {
      throw locationNotAllowed('The download location is not allowed.');
    }
    throw error;
  }
}

async function fileDownload(response: Response): Promise<AgentToolFileDownload> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw uploadStatusError(response);
  }
  const size = contentLength(response.headers.get('content-length'));
  if (size !== undefined && size > MAX_AGENT_TOOL_FILE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new LinearIntegrationProviderError(
      'file-too-large',
      `The file is larger than the ${MAX_AGENT_TOOL_FILE_BYTES / (1024 * 1024)} MiB limit.`,
    );
  }
  return {
    body: response.body ?? new ReadableStream<Uint8Array>({start: (c) => c.close()}),
    mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
    filename: contentDispositionFilename(response.headers.get('content-disposition')),
    size,
  };
}

function uploadStatusError(response: Response): LinearIntegrationProviderError {
  const status = response.status;
  if (status === 401) {
    return new LinearIntegrationProviderError(
      'credentials-unavailable',
      'Linear credentials are unavailable. Reconnect Linear and try again.',
      undefined,
      status,
    );
  }
  if (status === 403) {
    return new LinearIntegrationProviderError(
      'access-denied',
      'Linear denied access to the file.',
      undefined,
      status,
    );
  }
  if (status === 404) {
    return new LinearIntegrationProviderError(
      'file-not-found',
      'The Linear file was not found.',
      undefined,
      status,
    );
  }
  if (status === 429) {
    return new LinearIntegrationProviderError(
      'rate-limited',
      'Linear rate limited the request. Please try again later.',
      retryAfterSeconds(response.headers.get('retry-after')),
      status,
    );
  }
  if (status >= 400 && status < 500) {
    return new LinearIntegrationProviderError(
      'provider-rejected',
      'Linear rejected the request.',
      undefined,
      status,
    );
  }
  return new LinearIntegrationProviderError(
    'provider-unavailable',
    'Linear is temporarily unavailable. Please try again.',
    undefined,
    status,
  );
}

function contentDispositionFilename(header: string | null): string | undefined {
  if (header === null) return undefined;
  const extended = EXTENDED_FILENAME_PATTERN.exec(header)?.[1];
  if (extended !== undefined) {
    try {
      return decodeURIComponent(extended);
    } catch {
      // Fall back to the plain parameter when the extended one is malformed.
    }
  }
  const quoted = QUOTED_FILENAME_PATTERN.exec(header)?.[1];
  if (quoted !== undefined) return quoted.replace(QUOTED_PAIR_PATTERN, '$1');
  return TOKEN_FILENAME_PATTERN.exec(header)?.[1];
}

function contentLength(header: string | null): number | undefined {
  if (header === null || !DIGITS_PATTERN.test(header)) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) ? value : undefined;
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null || !DIGITS_PATTERN.test(header)) return undefined;
  return Number(header);
}

function parseUrl(value: string, base?: URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function locationNotAllowed(message: string): LinearIntegrationProviderError {
  return new LinearIntegrationProviderError('file-location-not-allowed', message);
}
