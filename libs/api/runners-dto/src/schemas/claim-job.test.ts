import {claimedJobResponseSchema} from './claim-job.js';

describe('claimedJobResponseSchema', () => {
  it('parses a step-less claim response', () => {
    const parsed = claimedJobResponseSchema.parse({
      job_id: crypto.randomUUID(),
      job_execution_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      lease_token: 'lease-abc',
    });

    expect(parsed.lease_token).toBe('lease-abc');
  });

  it('rejects a missing lease token', () => {
    const parse = () =>
      claimedJobResponseSchema.parse({
        job_id: crypto.randomUUID(),
        run_id: crypto.randomUUID(),
      });

    expect(parse).toThrow();
  });

  it('rejects an empty lease token', () => {
    const parse = () =>
      claimedJobResponseSchema.parse({
        job_id: crypto.randomUUID(),
        run_id: crypto.randomUUID(),
        lease_token: '',
      });

    expect(parse).toThrow();
  });

  it('rejects a non-uuid job id', () => {
    const parse = () =>
      claimedJobResponseSchema.parse({
        job_id: 'not-a-uuid',
        run_id: crypto.randomUUID(),
        lease_token: 'lease-abc',
      });

    expect(parse).toThrow();
  });
});
