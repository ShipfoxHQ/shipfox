import {ApiError} from '@shipfox/client-api';
import {configMoveErrorCopy, projectErrorCopy} from './project-error.js';

function apiError(code: string, details?: unknown) {
  return new ApiError({
    code,
    status: 400,
    message: code,
    details: details === undefined ? {code} : {code, details},
  });
}

describe('projectErrorCopy', () => {
  test.each([
    ['repository-not-found', 'Repository not found'],
    ['access-denied', 'Repository access denied'],
    ['timeout', 'Provider timed out'],
    ['provider-unavailable', 'Provider unavailable'],
    ['malformed-provider-response', 'Provider response changed'],
    ['source-connection-not-found', 'Source connection not found'],
    ['source-connection-inactive', 'Source connection inactive'],
    ['slug-conflict', 'Project slug already exists'],
  ])('maps %s', (code, title) => {
    const result = projectErrorCopy(apiError(code));

    expect(result.title).toBe(title);
    expect(result.message).not.toBe('');
  });

  test('includes retry-after copy for rate limits', () => {
    const result = projectErrorCopy(apiError('rate-limited', {retry_after_seconds: 60}));

    expect(result.title).toBe('Provider rate limited');
    expect(result.message).toContain('60 seconds');
  });

  test('surfaces duplicate project recovery id', () => {
    const result = projectErrorCopy(
      apiError('project-already-exists', {existing_project_id: 'project-1'}),
    );

    expect(result.title).toBe('Project already exists');
    expect(result.existingProjectId).toBe('project-1');
  });

  test('ignores malformed details payloads', () => {
    const result = projectErrorCopy(apiError('project-already-exists', 'bad-details'));

    expect(result.title).toBe('Project already exists');
    expect(result.existingProjectId).toBeUndefined();
  });

  test('maps network and unknown errors', () => {
    const network = projectErrorCopy(apiError('network-error'));
    const unknown = projectErrorCopy(new Error('boom'));

    expect(network.title).toBe('Network problem');
    expect(unknown.title).toBe('Something went wrong');
  });
});

describe('configMoveErrorCopy', () => {
  test.each([
    ['config-exists', 'Repository already has config'],
    ['repository-in-use', 'Repository already in use'],
    ['repository-empty', 'Repository has no commits'],
    ['connection-inactive', 'Connection inactive'],
    ['integration-connection-inactive', 'Connection inactive'],
    ['link-unsupported', 'Connection not supported'],
    ['access-denied', 'GitHub refused the pull request'],
    ['provider-rejected', 'GitHub refused the pull request'],
    ['repository-not-found', 'Repository not found'],
    ['pull-request-closed', 'Pull request closed'],
    ['source-already-bound', 'Another project took this repository'],
    ['source-changed', 'Config source changed'],
    ['move-in-progress', 'A move is already running'],
    ['already-moved', 'Project already moved'],
    ['project-not-managed', 'Project not managed by Shipfox'],
    ['no-pull-request', 'No config to add'],
    ['pull-request-not-closed', 'Pull request not closed'],
    ['move-unconfirmed', "We couldn't confirm the move"],
    ['impersonation-not-permitted', 'Not available while impersonating'],
  ])('maps %s', (code, title) => {
    const result = configMoveErrorCopy(apiError(code));

    expect(result.title).toBe(title);
    expect(result.message).not.toBe('');
  });

  test('names the repository', () => {
    const result = configMoveErrorCopy(apiError('config-exists'), {
      repositoryName: 'acme/payments',
    });

    expect(result.message).toContain('acme/payments already has a .shipfox/ directory');
  });

  test('falls back to the project copy', () => {
    expect(configMoveErrorCopy(apiError('timeout')).title).toBe('Provider timed out');
    expect(configMoveErrorCopy(new Error('boom')).title).toBe('Something went wrong');
  });
});
