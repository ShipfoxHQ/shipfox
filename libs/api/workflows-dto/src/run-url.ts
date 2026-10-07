const TRAILING_SLASHES = /\/+$/;

/** Permalink to a run in the client app, which resolves it to the run page. */
export function workflowRunUrl(params: {clientBaseUrl: string; runId: string}): string {
  return `${params.clientBaseUrl.replace(TRAILING_SLASHES, '')}/runs/${params.runId}`;
}
