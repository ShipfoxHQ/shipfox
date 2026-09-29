const metricMocks = vi.hoisted(() => {
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>} | undefined>();
  const createCounter = vi.fn((name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
  });
  const createHistogram = vi.fn(() => ({record: vi.fn()}));

  return {counters, createCounter, createHistogram};
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {
    getMeter: () => ({
      createCounter: metricMocks.createCounter,
      createHistogram: metricMocks.createHistogram,
    }),
  },
}));

const metrics = await import('./instance.js');

function connectCounter(): {add: ReturnType<typeof vi.fn>} {
  const counter = metricMocks.counters.get('integrations_github_connect');
  if (!counter) throw new Error('Missing GitHub connect counter');
  return counter;
}

describe('GitHub integration metrics', () => {
  beforeEach(() => {
    for (const counter of metricMocks.counters.values()) counter?.add.mockReset();
  });

  it('records only bounded flow and outcome labels', () => {
    metrics.recordGithubConnectOutcome({flow: 'install', outcome: 'success'});
    metrics.recordGithubConnectOutcome({flow: 'install', outcome: 'error'});

    expect(connectCounter().add).toHaveBeenNthCalledWith(1, 1, {
      flow: 'install',
      outcome: 'success',
    });
    expect(connectCounter().add).toHaveBeenNthCalledWith(2, 1, {
      flow: 'install',
      outcome: 'error',
    });
  });
});
