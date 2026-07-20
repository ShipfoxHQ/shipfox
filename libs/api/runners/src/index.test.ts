import {createRunnersModule, runnersModule} from './index.js';

describe('createRunnersModule', () => {
  it('preserves the default module composition when options are absent', () => {
    const module = createRunnersModule();

    expect(module.name).toBe(runnersModule.name);
    expect(module.auth).toHaveLength(runnersModule.auth?.length ?? 0);
    expect(module.routes).toHaveLength(runnersModule.routes?.length ?? 0);
    expect(module.workers).toHaveLength(runnersModule.workers?.length ?? 0);
  });

  it('accepts an instance-local installation provisioning policy', () => {
    const policy = {
      filterEligibleWorkspaceIds: vi.fn().mockResolvedValue(new Set<string>()),
    };

    const module = createRunnersModule({installationProvisioning: {policy}});

    expect(module.name).toBe('runners');
    expect(module.routes).not.toBe(runnersModule.routes);
    expect(policy.filterEligibleWorkspaceIds).not.toHaveBeenCalled();
  });
});
