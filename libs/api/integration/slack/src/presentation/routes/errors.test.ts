import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {slackRouteErrorHandler} from './errors.js';

describe('slackRouteErrorHandler workspace access errors', () => {
  it.each([
    ['workspace-not-found', 'not-found', 404],
    ['membership-required', 'forbidden', 403],
    ['workspace-inactive', 'workspace-inactive', 403],
  ] as const)('translates %s into %s', (error, code, status) => {
    const knownError = createInterModuleKnownError(
      workspacesInterModuleContract.methods.requireActiveMembership,
      error,
      {workspaceId: crypto.randomUUID()},
    );

    expect(() => slackRouteErrorHandler(knownError)).toThrow(ClientError);
    try {
      slackRouteErrorHandler(knownError);
    } catch (result) {
      expect(result).toMatchObject({code, status});
    }
  });
});
