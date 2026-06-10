import {checkoutIntentSchema, jobPayloadSchema} from './request-job.js';

const validStep = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'build',
  type: 'shell',
  config: {run: 'echo hi'},
  position: 0,
};

const validCheckout = {
  repository_url: 'https://github.com/acme/repo.git',
  ref: 'main',
  provider: 'github',
  source_connection_id: '22222222-2222-4222-8222-222222222222',
  external_repository_id: 'acme/repo',
};

const baseJobPayload = {
  job_id: '33333333-3333-4333-8333-333333333333',
  run_id: '44444444-4444-4444-8444-444444444444',
  job_name: 'ci',
  steps: [validStep],
};

describe('jobPayloadSchema checkout intent', () => {
  it('accepts a payload with no checkout key (old-runner compatibility)', () => {
    const result = jobPayloadSchema.parse(baseJobPayload);

    expect(result.checkout).toBeUndefined();
  });

  it('accepts a payload with checkout explicitly null', () => {
    const result = jobPayloadSchema.parse({...baseJobPayload, checkout: null});

    expect(result.checkout).toBeNull();
  });

  it('round-trips a payload carrying a full credential-free checkout intent', () => {
    const input = {...baseJobPayload, checkout: validCheckout};

    const result = jobPayloadSchema.parse(input);

    expect(result.checkout).toEqual(validCheckout);
  });

  it('rejects a checkout intent missing a required field', () => {
    const {provider: _provider, ...checkoutWithoutProvider} = validCheckout;
    const input = {...baseJobPayload, checkout: checkoutWithoutProvider};

    const parse = () => jobPayloadSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects a checkout intent with a non-UUID source_connection_id', () => {
    const input = {
      ...baseJobPayload,
      checkout: {...validCheckout, source_connection_id: 'not-a-uuid'},
    };

    const parse = () => jobPayloadSchema.parse(input);

    expect(parse).toThrow();
  });
});

describe('checkoutIntentSchema', () => {
  it('round-trips a valid intent unchanged (serialization)', () => {
    const result = checkoutIntentSchema.parse(validCheckout);

    expect(result).toEqual(validCheckout);
  });
});
