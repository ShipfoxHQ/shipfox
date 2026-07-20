import {ClientError} from '@shipfox/node-fastify';
import {
  requireInstallationProvisionerContext,
  requireWorkspaceProvisionerContext,
  setProvisionerContext,
} from './index.js';

describe('provisioner context', () => {
  it('returns only a workspace context from the workspace guard', () => {
    const request = {};
    const context = {
      provisionerTokenId: crypto.randomUUID(),
      scope: 'workspace' as const,
      workspaceId: crypto.randomUUID(),
    };
    setProvisionerContext(request, context);

    const result = requireWorkspaceProvisionerContext(request);

    expect(result).toEqual(context);
  });

  it('returns only an installation context from the installation guard', () => {
    const request = {};
    const context = {provisionerTokenId: crypto.randomUUID(), scope: 'installation' as const};
    setProvisionerContext(request, context);

    const result = requireInstallationProvisionerContext(request);

    expect(result).toEqual(context);
  });

  it('rejects a credential with the wrong scope', () => {
    const request = {};
    setProvisionerContext(request, {
      provisionerTokenId: crypto.randomUUID(),
      scope: 'installation',
    });

    expect(() => requireWorkspaceProvisionerContext(request)).toThrow(
      new ClientError('Workspace provisioner credential required', 'forbidden', {status: 403}),
    );
  });
});
