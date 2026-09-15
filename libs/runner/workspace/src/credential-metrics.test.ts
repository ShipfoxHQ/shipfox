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
    getMeter: () => ({createCounter: metricMocks.createCounter}),
  },
}));

const metrics = await import('./credential-metrics.js');

function checkoutFetchAttemptAdd(): ReturnType<typeof vi.fn> {
  const counter = metricMocks.counters.get('runner_checkout_fetch_attempts');
  if (!counter) throw new Error('Missing checkout fetch attempts counter');
  return counter.add;
}

describe('checkout fetch metrics', () => {
  beforeEach(() => {
    for (const counter of metricMocks.counters.values()) counter.add.mockReset();
  });

  it('records bounded initial failure dimensions', () => {
    metrics.recordCheckoutFetchAttempt('initial', 'failure', 'auth');

    expect(checkoutFetchAttemptAdd()).toHaveBeenCalledWith(1, {
      attempt: 'initial',
      outcome: 'failure',
      reason: 'auth',
    });
  });

  it('records bounded retry recovery dimensions', () => {
    metrics.recordCheckoutFetchAttempt('retry', 'success', 'none');

    expect(checkoutFetchAttemptAdd()).toHaveBeenCalledWith(1, {
      attempt: 'retry',
      outcome: 'success',
      reason: 'none',
    });
  });
});
