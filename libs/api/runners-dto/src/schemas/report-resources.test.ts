import {
  MAX_RESOURCE_REPORT_EVENTS,
  reportResourcesBodySchema,
  resourceReportEventSchema,
} from './report-resources.js';

describe('resourceReportEventSchema', () => {
  it('accepts minimal provider-agnostic lifecycle events', () => {
    const result = resourceReportEventSchema.safeParse({
      resource_id: 'container-1',
      labels: ['linux'],
      state: 'starting',
      reported_at: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('rejects provider-sensitive extra fields', () => {
    const result = resourceReportEventSchema.safeParse({
      resource_id: 'container-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
      ip_address: '192.0.2.1',
    });

    expect(result.success).toBe(false);
  });
});

describe('reportResourcesBodySchema', () => {
  it('enforces the batch size limit', () => {
    const event = {
      resource_id: 'container-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
    };

    const result = reportResourcesBodySchema.safeParse({
      events: Array.from({length: MAX_RESOURCE_REPORT_EVENTS + 1}, (_, index) => ({
        ...event,
        resource_id: `container-${index}`,
      })),
    });

    expect(result.success).toBe(false);
  });
});
