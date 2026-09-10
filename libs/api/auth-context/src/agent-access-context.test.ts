import {
  getAgentAccessContext,
  getAgentLogDownloadContext,
  requireAgentAccessContext,
  requireAgentLogDownloadContext,
  setAgentAccessContext,
  setAgentLogDownloadContext,
} from './index.js';

describe('agent access context', () => {
  test('stores and reads the common identity for an OAuth grant', () => {
    const request = {};
    const context = {
      userId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      scopes: ['read'] as const,
      credential: {
        kind: 'oauth_grant' as const,
        grantId: crypto.randomUUID(),
        clientId: 'client-id',
      },
    };

    setAgentAccessContext(request, context);

    expect(getAgentAccessContext(request)).toEqual(context);
    expect(requireAgentAccessContext(request)).toEqual(context);
  });

  test('stores and reads a stream-bound download identity', () => {
    const request = {};
    const context = {
      userId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      grantId: crypto.randomUUID(),
      streamId: crypto.randomUUID(),
    };

    setAgentLogDownloadContext(request, context);

    expect(getAgentLogDownloadContext(request)).toEqual(context);
    expect(requireAgentLogDownloadContext(request)).toEqual(context);
  });

  test('returns null until an agent credential has authenticated the request', () => {
    expect(getAgentAccessContext({})).toBeNull();
    expect(() => requireAgentAccessContext({})).toThrow(
      'Agent access context is not available on this request',
    );
    expect(() => requireAgentLogDownloadContext({})).toThrow(
      'Agent log download context is not available on this request',
    );
  });
});
