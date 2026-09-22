const RUN_PERMALINK_PATH = '/runs/';
const TRAILING_SLASHES = /\/+$/u;

export function buildRunUrl(clientBaseUrl: string | undefined, runId: string): string | undefined {
  if (clientBaseUrl === undefined) return undefined;

  let parsedClientBaseUrl: URL;
  try {
    parsedClientBaseUrl = new URL(clientBaseUrl);
  } catch {
    return undefined;
  }
  if (parsedClientBaseUrl.protocol !== 'http:' && parsedClientBaseUrl.protocol !== 'https:') {
    return undefined;
  }

  return `${clientBaseUrl.replace(TRAILING_SLASHES, '')}${RUN_PERMALINK_PATH}${runId}`;
}
