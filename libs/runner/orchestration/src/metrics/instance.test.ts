const metricMocks = vi.hoisted(() => {
  const gauges = new Map<string, {record: ReturnType<typeof vi.fn>}>();
  const createGauge = vi.fn((name: string) => {
    const gauge = {record: vi.fn()};
    gauges.set(name, gauge);
    return gauge;
  });
  return {gauges, createGauge};
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {getMeter: () => ({createGauge: metricMocks.createGauge})},
}));

const metrics = await import('./instance.js');

describe('recordJobStepsInFlight', () => {
  it('records the number of step attempts in flight on an unlabeled gauge', () => {
    metrics.recordJobStepsInFlight(3);

    expect(metricMocks.gauges.get('runner_job_steps_in_flight')?.record).toHaveBeenCalledWith(3);
  });

  it('does not throw when the gauge fails to record', () => {
    metricMocks.gauges.get('runner_job_steps_in_flight')?.record.mockImplementationOnce(() => {
      throw new Error('exporter failed');
    });

    expect(() => metrics.recordJobStepsInFlight(0)).not.toThrow();
  });
});
