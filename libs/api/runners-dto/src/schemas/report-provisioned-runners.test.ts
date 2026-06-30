import {
  MAX_PROVISIONED_RUNNER_REPORT_EVENTS,
  provisionedRunnerReportEventSchema,
  reportProvisionedRunnersBodySchema,
} from './report-provisioned-runners.js';

describe('provisionedRunnerReportEventSchema', () => {
  it('accepts minimal provider-agnostic lifecycle events', () => {
    const result = provisionedRunnerReportEventSchema.safeParse({
      provisioned_runner_id: 'container-1',
      labels: ['linux'],
      state: 'starting',
      reported_at: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('accepts cleanup-confirmed terminated lifecycle events', () => {
    const result = provisionedRunnerReportEventSchema.safeParse({
      provisioned_runner_id: 'container-1',
      labels: ['linux'],
      state: 'terminated',
      reported_at: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('rejects provider-sensitive extra fields', () => {
    const result = provisionedRunnerReportEventSchema.safeParse({
      provisioned_runner_id: 'container-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
      ip_address: '192.0.2.1',
    });

    expect(result.success).toBe(false);
  });
});

describe('reportProvisionedRunnersBodySchema', () => {
  it('enforces the batch size limit', () => {
    const event = {
      provisioned_runner_id: 'container-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
    };

    const result = reportProvisionedRunnersBodySchema.safeParse({
      events: Array.from({length: MAX_PROVISIONED_RUNNER_REPORT_EVENTS + 1}, (_, index) => ({
        ...event,
        provisioned_runner_id: `container-${index}`,
      })),
    });

    expect(result.success).toBe(false);
  });
});
