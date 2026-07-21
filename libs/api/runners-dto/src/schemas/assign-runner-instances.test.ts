import {assignRunnerInstancesBodySchema} from './assign-runner-instances.js';

describe('assignRunnerInstancesBodySchema', () => {
  it('accepts a reservation and unique runner instances', () => {
    const result = assignRunnerInstancesBodySchema.safeParse({
      reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
      runner_instance_ids: [
        '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0002',
        '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0003',
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects duplicate runner instances', () => {
    const result = assignRunnerInstancesBodySchema.safeParse({
      reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
      runner_instance_ids: [
        '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0002',
        '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0002',
      ],
    });

    expect(result.success).toBe(false);
  });
});
