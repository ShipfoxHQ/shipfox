const RUN_PERMALINK_PATH = '/runs/';
const TRAILING_SLASHES = /\/+$/u;

export function buildRunUrl(clientBaseUrl: string | undefined, runId: string): string | undefined {
  if (clientBaseUrl === undefined) return undefined;
  return `${clientBaseUrl.replace(TRAILING_SLASHES, '')}${RUN_PERMALINK_PATH}${runId}`;
}
