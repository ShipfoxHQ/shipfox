const metricMocks = vi.hoisted(() => {
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const histograms = new Map<string, {record: ReturnType<typeof vi.fn>}>();
  const createCounter = vi.fn((name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
  });
  const createHistogram = vi.fn((name: string) => {
    const histogram = {record: vi.fn()};
    histograms.set(name, histogram);
    return histogram;
  });

  return {counters, createCounter, createHistogram, histograms};
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

function counterAdd(name: string): ReturnType<typeof vi.fn> {
  const counter = metricMocks.counters.get(name);
  if (!counter) throw new Error(`Missing counter: ${name}`);
  return counter.add;
}

describe('auth metrics', () => {
  beforeEach(() => {
    for (const counter of metricMocks.counters.values()) {
      counter.add.mockReset();
    }
    for (const histogram of metricMocks.histograms.values()) {
      histogram.record.mockReset();
    }
  });

  it('records auth rate-limit checks with low-cardinality labels', () => {
    metrics.recordAuthRateLimitCheck({
      action: 'login',
      scope: 'ip',
      outcome: 'blocked',
    });

    expect(counterAdd('auth_rate_limit_checks')).toHaveBeenCalledWith(1, {
      action: 'login',
      scope: 'ip',
      outcome: 'blocked',
    });
  });

  it('records auth rate-limit prune failures', () => {
    metrics.recordAuthRateLimitPruneFailure();

    expect(counterAdd('auth_rate_limit_prune_failures')).toHaveBeenCalledWith(1);
  });

  it('records token issuance and verification outcomes by token type', () => {
    metrics.recordTokenIssued('agent_access');
    metrics.recordTokenVerified('agent_access', 'rejected');

    expect(counterAdd('auth_token_issued')).toHaveBeenCalledWith(1, {
      token_type: 'agent_access',
    });
    expect(counterAdd('auth_token_verified')).toHaveBeenCalledWith(1, {
      token_type: 'agent_access',
      outcome: 'rejected',
    });
  });

  it('records refresh-token reuse as a security outcome', () => {
    metrics.recordTokenRefreshed('reused');

    expect(counterAdd('auth_token_refreshed')).toHaveBeenCalledWith(1, {
      outcome: 'reused',
    });
  });

  it('records window lifecycle metrics without identifier labels', () => {
    metrics.recordImpersonationWindowStartOutcome('succeeded');
    metrics.recordImpersonationContinuationOutcome('failed');
    metrics.recordImpersonationStopOutcome('succeeded');
    metrics.recordImpersonationWindowEnded('expired');
    metrics.recordImpersonationWindowDuration(42);

    expect(counterAdd('auth_impersonation_window_starts')).toHaveBeenCalledWith(1, {
      outcome: 'succeeded',
    });
    expect(counterAdd('auth_impersonation_continuations')).toHaveBeenCalledWith(1, {
      outcome: 'failed',
    });
    expect(counterAdd('auth_impersonation_stops')).toHaveBeenCalledWith(1, {
      outcome: 'succeeded',
    });
    expect(counterAdd('auth_impersonation_windows_ended')).toHaveBeenCalledWith(1, {
      reason: 'expired',
    });
    expect(
      metricMocks.histograms.get('auth_impersonation_window_duration_seconds')?.record,
    ).toHaveBeenCalledWith(42);
  });

  it('does not record invalid window durations', () => {
    metrics.recordImpersonationWindowDuration(-1);
    metrics.recordImpersonationWindowDuration(Number.NaN);

    expect(
      metricMocks.histograms.get('auth_impersonation_window_duration_seconds')?.record,
    ).not.toHaveBeenCalled();
  });

  it('does not let metric failures affect callers', () => {
    counterAdd('auth_rate_limit_checks').mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });

    const act = () =>
      metrics.recordAuthRateLimitCheck({
        action: 'email-send',
        scope: 'email',
        outcome: 'unavailable',
      });

    expect(act).not.toThrow();
  });
});
