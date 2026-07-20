import {
  MembershipRequiredError,
  WorkspaceInactiveError,
  WorkspaceNotFoundError,
} from '@shipfox/api-workspaces/errors';
import {ClientError} from '@shipfox/node-fastify';
import {slackRouteErrorHandler} from './errors.js';

describe('slackRouteErrorHandler workspace access errors', () => {
  it.each([
    [new WorkspaceNotFoundError('workspace-1'), 'not-found', 404],
    [new MembershipRequiredError('workspace-1'), 'forbidden', 403],
    [new WorkspaceInactiveError('workspace-1'), 'workspace-inactive', 403],
  ])('translates %s into %s', (error, code, status) => {
    expect(() => slackRouteErrorHandler(error)).toThrow(ClientError);
    try {
      slackRouteErrorHandler(error);
    } catch (result) {
      expect(result).toMatchObject({code, status});
    }
  });
});
