import {createWorkspaceStorageLimits} from './storage-policy.js';

describe('workspace storage limits', () => {
  it('asks the policy once per workspace within 60 seconds', async () => {
    let clock = 0;
    const resolve = vi.fn().mockResolvedValue({maxStoredBytes: 100});
    const limits = createWorkspaceStorageLimits({resolve}, () => clock);

    await limits.maxStoredBytes('workspace-a');
    clock = 59_999;
    const cached = await limits.maxStoredBytes('workspace-a');
    clock = 60_000;
    await limits.maxStoredBytes('workspace-a');

    expect(cached).toBe(100);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('applies no limit when the policy throws, and asks again next time', async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error('policy unavailable'))
      .mockResolvedValue({maxStoredBytes: 100});
    const limits = createWorkspaceStorageLimits({resolve});

    const failed = await limits.maxStoredBytes('workspace-a');
    const recovered = await limits.maxStoredBytes('workspace-a');

    expect(failed).toBeNull();
    expect(recovered).toBe(100);
  });

  it('has no limit without a policy and without CACHE_WORKSPACE_MAX_BYTES', async () => {
    const limits = createWorkspaceStorageLimits();

    const result = await limits.maxStoredBytes('workspace-a');

    expect(result).toBeNull();
  });
});
