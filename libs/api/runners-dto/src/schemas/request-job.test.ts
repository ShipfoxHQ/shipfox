import {checkoutIntentSchema} from './request-job.js';

const validCheckout = {
  repository_url: 'https://github.com/acme/repo.git',
  ref: 'main',
  provider: 'github',
  source_connection_id: '22222222-2222-4222-8222-222222222222',
  external_repository_id: 'acme/repo',
};

describe('checkoutIntentSchema', () => {
  it('round-trips a valid credential-free intent unchanged', () => {
    const result = checkoutIntentSchema.parse(validCheckout);

    expect(result).toEqual(validCheckout);
  });

  it('rejects an intent missing a required field', () => {
    const {provider: _provider, ...checkoutWithoutProvider} = validCheckout;

    const parse = () => checkoutIntentSchema.parse(checkoutWithoutProvider);

    expect(parse).toThrow();
  });

  it('rejects a non-UUID source_connection_id', () => {
    const input = {...validCheckout, source_connection_id: 'not-a-uuid'};

    const parse = () => checkoutIntentSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects an empty repository_url', () => {
    const input = {...validCheckout, repository_url: ''};

    const parse = () => checkoutIntentSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects an empty provider', () => {
    const input = {...validCheckout, provider: ''};

    const parse = () => checkoutIntentSchema.parse(input);

    expect(parse).toThrow();
  });
});
