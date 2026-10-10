import {RequestError} from 'octokit';
import {mapGithubError} from '#api/client.js';
import {GithubIntegrationProviderError} from '#core/errors.js';

function githubFailure(status: number, message: string, headers: Record<string, string> = {}) {
  return new RequestError(message, status, {
    request: {method: 'POST', url: 'https://api.github.com/repos/shipfox/platform', headers: {}},
    response: {
      status,
      url: 'https://api.github.com/repos/shipfox/platform',
      headers,
      data: {message},
    },
  });
}

async function mapped(error: unknown): Promise<GithubIntegrationProviderError> {
  try {
    await mapGithubError(() => Promise.reject(error), 'provider-rejected');
  } catch (caught) {
    if (caught instanceof GithubIntegrationProviderError) return caught;
    throw caught;
  }
  throw new Error('The operation did not fail');
}

describe('github error detail', () => {
  it.each([
    ['stale-head', 422, 'Update is not a fast forward'],
    ['branch-not-found', 422, 'Reference does not exist'],
    ['branch-not-found', 404, 'Branch not found'],
    ['branch-exists', 422, 'Reference already exists'],
    [
      'pull-request-exists',
      422,
      'Validation Failed: {"resource":"PullRequest","code":"custom","message":"A pull request already exists for shipfox:candidate."}',
    ],
    [
      'no-commits-between',
      422,
      'Validation Failed: {"resource":"PullRequest","code":"custom","message":"No commits between main and candidate"}',
    ],
    ['protected-branch', 422, 'Protected branch update failed for refs/heads/main.'],
    [
      'protected-branch',
      422,
      'Repository rule violations found\n\nChanges must be made through a pull request.',
    ],
    ['unprocessable', 422, 'Validation Failed'],
  ])('names %s for a %i "%s"', async (detail, status, message) => {
    const error = await mapped(githubFailure(status, message));

    expect(error.detail).toBe(detail);
    expect(error.message).toContain(message);
  });

  it('keeps an unknown failure as provider-rejected with its message and no detail', async () => {
    const error = await mapped(githubFailure(409, 'Git Repository is empty.'));

    expect(error).toMatchObject({
      reason: 'provider-rejected',
      message: 'Git Repository is empty.',
      detail: undefined,
    });
  });

  it('names permission-denied when GitHub lists the permissions it would accept', async () => {
    const error = await mapped(
      githubFailure(403, 'Resource not accessible by integration', {
        'x-accepted-github-permissions': 'contents=write',
      }),
    );

    expect(error).toMatchObject({reason: 'access-denied', detail: 'permission-denied'});
  });

  it('leaves a 403 that is not a permission denial without a detail', async () => {
    const error = await mapped(githubFailure(403, 'Repository was archived so is read-only.'));

    expect(error).toMatchObject({reason: 'provider-rejected', detail: undefined});
  });

  it('does not call a rate limit a permission denial', async () => {
    const error = await mapped(
      githubFailure(403, 'API rate limit exceeded', {'x-ratelimit-remaining': '0'}),
    );

    expect(error.reason).toBe('rate-limited');
    expect(error.detail).toBeUndefined();
  });
});
