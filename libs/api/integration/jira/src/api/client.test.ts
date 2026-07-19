import {HTTPError} from 'ky';
import type {JiraIntegrationProviderError} from '#core/errors.js';
import {mapJiraError} from './client.js';

function rejectedRequest(status: number): () => Promise<never> {
  return () =>
    Promise.reject(
      new HTTPError(
        new Response(null, {status}),
        new Request('https://jira.example.test'),
        {} as never,
      ),
    );
}

describe('mapJiraError', () => {
  it.each([
    [401, 'access-denied'],
    [403, 'access-denied'],
    [400, 'malformed-provider-response'],
    [404, 'malformed-provider-response'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const result = mapJiraError('test', rejectedRequest(status));

    await expect(result).rejects.toMatchObject({
      reason,
    } satisfies Partial<JiraIntegrationProviderError>);
  });
});
