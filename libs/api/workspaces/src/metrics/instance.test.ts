const metricMocks = vi.hoisted(() => {
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const createCounter = vi.fn((name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
  });

  return {counters, createCounter};
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {
    getMeter: () => ({
      createCounter: metricMocks.createCounter,
    }),
  },
}));

function counterAdd(name: string): ReturnType<typeof vi.fn> {
  const counter = metricMocks.counters.get(name);
  if (!counter) throw new Error(`Missing counter: ${name}`);
  return counter.add;
}

let metrics: typeof import('./instance.js');

describe('workspace metrics', () => {
  beforeEach(async () => {
    vi.resetModules();
    metricMocks.counters.clear();
    metrics = await import('./instance.js');
  });

  it('records workspace creation', () => {
    metrics.recordWorkspaceCreated();

    expect(counterAdd('workspaces_created')).toHaveBeenCalledWith(1);
  });

  it('records membership changes with bounded action labels', () => {
    metrics.recordWorkspaceMembershipChanged('removed');

    expect(counterAdd('workspaces_membership_changed')).toHaveBeenCalledWith(1, {
      action: 'removed',
    });
  });

  it('records invitation creation with email request labels', () => {
    metrics.recordWorkspaceInvitationCreated('requested');

    expect(counterAdd('workspaces_invitation_created')).toHaveBeenCalledWith(1, {
      email_requested: 'requested',
    });
  });

  it('records invitation acceptance outcomes', () => {
    metrics.recordWorkspaceInvitationAccepted('already_member');

    expect(counterAdd('workspaces_invitation_accepted')).toHaveBeenCalledWith(1, {
      outcome: 'already_member',
    });
  });

  it('does not let metric failures affect callers', () => {
    counterAdd('workspaces_membership_changed').mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });

    const act = () => metrics.recordWorkspaceMembershipChanged('added');

    expect(act).not.toThrow();
  });
});
