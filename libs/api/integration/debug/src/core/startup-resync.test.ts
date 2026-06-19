import {
  type DebugStartupResyncDeps,
  emitDebugStartupResync,
  type PublishDebugSourceCommitPushedParams,
} from '#core/startup-resync.js';

const DELIVERY_ID_PATTERN = /^debug-startup-resync:/;

describe('emitDebugStartupResync', () => {
  it('publishes one debug:platform default-branch push per connection', async () => {
    const published: PublishDebugSourceCommitPushedParams[] = [];
    const deps: DebugStartupResyncDeps = {
      listConnections: async () => [
        {id: 'conn-1', workspaceId: 'ws-1'},
        {id: 'conn-2', workspaceId: 'ws-2'},
      ],
      publishSourceCommitPushed: (params) => {
        published.push(params);
        return Promise.resolve();
      },
    };

    await emitDebugStartupResync(deps);

    expect(published.map((entry) => [entry.connectionId, entry.workspaceId])).toEqual([
      ['conn-1', 'ws-1'],
      ['conn-2', 'ws-2'],
    ]);
    for (const entry of published) {
      expect(entry.provider).toBe('debug');
      expect(entry.deliveryId).toMatch(DELIVERY_ID_PATTERN);
      expect(entry.push).toMatchObject({
        externalRepositoryId: 'debug:platform',
        ref: 'main',
        defaultBranch: 'main',
        isDefaultBranch: true,
        headCommitSha: 'debug-startup-resync',
      });
    }
  });

  it('does not publish when there are no debug connections', async () => {
    const publishSourceCommitPushed = vi.fn();
    const deps: DebugStartupResyncDeps = {
      listConnections: async () => [],
      publishSourceCommitPushed,
    };

    await emitDebugStartupResync(deps);

    expect(publishSourceCommitPushed).not.toHaveBeenCalled();
  });

  it('attempts every connection and aggregates failures when some publishes fail', async () => {
    const published: PublishDebugSourceCommitPushedParams[] = [];
    const deps: DebugStartupResyncDeps = {
      listConnections: async () => [
        {id: 'conn-1', workspaceId: 'ws-1'},
        {id: 'conn-2', workspaceId: 'ws-2'},
        {id: 'conn-3', workspaceId: 'ws-3'},
      ],
      publishSourceCommitPushed: (params) => {
        if (params.connectionId === 'conn-2') return Promise.reject(new Error('boom'));
        published.push(params);
        return Promise.resolve();
      },
    };

    const result = emitDebugStartupResync(deps);

    await expect(result).rejects.toBeInstanceOf(AggregateError);
    expect(published.map((entry) => entry.connectionId)).toEqual(['conn-1', 'conn-3']);
  });

  it('uses a unique deliveryId per emission', async () => {
    const published: PublishDebugSourceCommitPushedParams[] = [];
    const deps: DebugStartupResyncDeps = {
      listConnections: async () => [
        {id: 'conn-1', workspaceId: 'ws-1'},
        {id: 'conn-1', workspaceId: 'ws-1'},
      ],
      publishSourceCommitPushed: (params) => {
        published.push(params);
        return Promise.resolve();
      },
    };

    await emitDebugStartupResync(deps);

    const deliveryIds = new Set(published.map((entry) => entry.deliveryId));
    expect(deliveryIds.size).toBe(2);
  });
});
