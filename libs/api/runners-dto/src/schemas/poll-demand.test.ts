import {pollDemandResponseSchema} from './poll-demand.js';

describe('pollDemandResponseSchema', () => {
  it('requires datetime response fields to be ISO datetimes', () => {
    const result = pollDemandResponseSchema.safeParse({
      stats: [
        {
          labels: ['linux'],
          queued: 1,
          reserved: 1,
          oldest_queued_at: 'not-a-date',
        },
      ],
      reservations: [
        {
          reservation_id: crypto.randomUUID(),
          labels: ['linux'],
          count: 1,
          expires_at: 'not-a-date',
        },
      ],
      terminate_provider_runner_ids: [],
    });

    expect(result.success).toBe(false);
  });
});
