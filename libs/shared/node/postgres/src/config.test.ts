import {loadPostgresConfig} from './config.js';

describe('loadPostgresConfig', () => {
  it('rejects an unsupported TLS mode', () => {
    const act = () => loadPostgresConfig({POSTGRES_TLS_MODE: 'require'});

    expect(act).toThrow('process.exit unexpectedly called with "1"');
  });

  it.each([
    'POSTGRES_MAX_CONNECTIONS',
    'POSTGRES_CONNECTION_TIMEOUT_MS',
    'POSTGRES_IDLE_TIMEOUT_MS',
  ] as const)('rejects a non-numeric %s value', (name) => {
    const act = () => loadPostgresConfig({[name]: 'invalid'});

    expect(act).toThrow('process.exit unexpectedly called with "1"');
  });
});
