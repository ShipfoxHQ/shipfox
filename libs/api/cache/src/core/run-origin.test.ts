import {RunNotFoundError} from './errors.js';
import {createRunOriginResolver} from './run-origin.js';

const workspaceId = crypto.randomUUID();
const farFuture = Math.floor(Date.now() / 1000) + 3600;

describe('createRunOriginResolver', () => {
  it('asks Workflows once for the life of the lease', async () => {
    const workflowRunId = crypto.randomUUID();
    const getWorkflowRunOrigin = vi
      .fn()
      .mockResolvedValue({origin: 'dev', initiatedByUserId: 'user-1'});
    const resolver = createRunOriginResolver({getWorkflowRunOrigin});

    const first = await resolver.resolve({workspaceId, workflowRunId, leaseExpiresAt: farFuture});
    const second = await resolver.resolve({workspaceId, workflowRunId, leaseExpiresAt: farFuture});

    expect(first).toEqual({origin: 'dev', initiatedByUserId: 'user-1'});
    expect(second).toBe(first);
    expect(getWorkflowRunOrigin).toHaveBeenCalledTimes(1);
    expect(getWorkflowRunOrigin).toHaveBeenCalledWith({workspaceId, workflowRunId});
  });

  it('asks again once the lease that cached the answer has expired', async () => {
    const workflowRunId = crypto.randomUUID();
    const getWorkflowRunOrigin = vi
      .fn()
      .mockResolvedValue({origin: 'synced', initiatedByUserId: null});
    const resolver = createRunOriginResolver({getWorkflowRunOrigin});
    const expired = Math.floor(Date.now() / 1000) - 1;

    await resolver.resolve({workspaceId, workflowRunId, leaseExpiresAt: expired});
    await resolver.resolve({workspaceId, workflowRunId, leaseExpiresAt: farFuture});

    expect(getWorkflowRunOrigin).toHaveBeenCalledTimes(2);
  });

  it('fails for a run Workflows does not know and does not cache the failure', async () => {
    const workflowRunId = crypto.randomUUID();
    const getWorkflowRunOrigin = vi.fn().mockResolvedValue(null);
    const resolver = createRunOriginResolver({getWorkflowRunOrigin});

    await expect(
      resolver.resolve({workspaceId, workflowRunId, leaseExpiresAt: farFuture}),
    ).rejects.toThrow(RunNotFoundError);
    await expect(
      resolver.resolve({workspaceId, workflowRunId, leaseExpiresAt: farFuture}),
    ).rejects.toThrow(RunNotFoundError);
    expect(getWorkflowRunOrigin).toHaveBeenCalledTimes(2);
  });
});
