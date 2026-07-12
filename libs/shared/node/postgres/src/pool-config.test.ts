import {loadPostgresConfig} from './config.js';
import {createPoolConfig} from './pool-config.js';

describe('createPoolConfig', () => {
  it.each([
    ['disable', false],
    ['verify-full', {rejectUnauthorized: true}],
  ] as const)('maps the %s TLS mode', (tlsMode, expected) => {
    const config = loadPostgresConfig({POSTGRES_TLS_MODE: tlsMode});

    const poolConfig = createPoolConfig(config);

    expect(poolConfig.ssl).toEqual(expected);
  });

  it('maps the maximum connection count', () => {
    const config = loadPostgresConfig({POSTGRES_MAX_CONNECTIONS: '1'});

    const poolConfig = createPoolConfig(config);

    expect(poolConfig.max).toBe(1);
  });

  it('maps connection and idle timeouts', () => {
    const config = loadPostgresConfig({
      POSTGRES_CONNECTION_TIMEOUT_MS: '2000',
      POSTGRES_IDLE_TIMEOUT_MS: '3000',
    });

    const poolConfig = createPoolConfig(config);

    expect(poolConfig.connectionTimeoutMillis).toBe(2_000);
    expect(poolConfig.idleTimeoutMillis).toBe(3_000);
  });

  it('keeps caller overrides backward compatible', () => {
    const config = loadPostgresConfig({
      POSTGRES_MAX_CONNECTIONS: '10',
      POSTGRES_TLS_MODE: 'disable',
    });

    const poolConfig = createPoolConfig(config, {
      max: 2,
      ssl: {rejectUnauthorized: true},
    });

    expect(poolConfig.max).toBe(2);
    expect(poolConfig.ssl).toEqual({rejectUnauthorized: true});
  });
});
