import {jobPayloadSchema} from './request-job.js';

const validStep = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'build',
  type: 'shell',
  config: {run: 'echo hi'},
  position: 0,
};

const validPayload = {
  job_id: '33333333-3333-4333-8333-333333333333',
  run_id: '44444444-4444-4444-8444-444444444444',
  job_name: 'ci',
  steps: [validStep],
};

describe('jobPayloadSchema', () => {
  it('round-trips a valid job payload unchanged', () => {
    const result = jobPayloadSchema.parse(validPayload);

    expect(result).toEqual(validPayload);
  });

  it('accepts a step with a null name', () => {
    const input = {...validPayload, steps: [{...validStep, name: null}]};

    const result = jobPayloadSchema.parse(input);

    expect(result.steps[0]?.name).toBeNull();
  });

  it('rejects an empty steps array', () => {
    const input = {...validPayload, steps: []};

    const parse = () => jobPayloadSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects a non-UUID job_id', () => {
    const input = {...validPayload, job_id: 'not-a-uuid'};

    const parse = () => jobPayloadSchema.parse(input);

    expect(parse).toThrow();
  });
});
