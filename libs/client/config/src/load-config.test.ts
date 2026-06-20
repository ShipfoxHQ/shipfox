import {z} from 'zod';
import {envNameFor, envVarsFor, loadConfig} from './load-config.js';

const shape = {
  apiUrl: z.string().url().or(z.literal('')).default('').describe('Base URL of the Shipfox API.'),
  datadogClientToken: z.string().describe('Datadog RUM client token.'),
};

describe('envNameFor', () => {
  it.each([
    ['apiUrl', 'API_URL'],
    ['datadogClientToken', 'DATADOG_CLIENT_TOKEN'],
    ['datadogApplicationId', 'DATADOG_APPLICATION_ID'],
    ['environment', 'ENVIRONMENT'],
  ])('maps %s to %s', (key, expected) => {
    const result = envNameFor(key);

    expect(result).toBe(expected);
  });
});

describe('envVarsFor', () => {
  it('lists the self-host and build-time env vars', () => {
    const result = envVarsFor('apiUrl');

    expect(result).toEqual(['SHIPFOX_PUBLIC_API_URL', 'VITE_API_URL']);
  });
});

describe('loadConfig', () => {
  it('reads runtime values by their SCREAMING_SNAKE key', () => {
    const result = loadConfig(shape, {
      runtime: {API_URL: 'https://api.runtime.test', DATADOG_CLIENT_TOKEN: 'dd-token'},
    });

    expect(result).toEqual({
      ok: true,
      config: {apiUrl: 'https://api.runtime.test', datadogClientToken: 'dd-token'},
    });
  });

  it('falls back to the build value when the runtime value is absent', () => {
    const result = loadConfig(shape, {
      runtime: {DATADOG_CLIENT_TOKEN: 'dd-token'},
      build: {VITE_API_URL: 'https://api.build.test'},
    });

    expect(result.ok && result.config.apiUrl).toBe('https://api.build.test');
  });

  it('prefers the runtime value over the build value', () => {
    const result = loadConfig(shape, {
      runtime: {API_URL: 'https://api.runtime.test', DATADOG_CLIENT_TOKEN: 'dd-token'},
      build: {VITE_API_URL: 'https://api.build.test'},
    });

    expect(result.ok && result.config.apiUrl).toBe('https://api.runtime.test');
  });

  it('applies schema defaults when a key is set in neither source', () => {
    const result = loadConfig(shape, {runtime: {DATADOG_CLIENT_TOKEN: 'dd-token'}});

    expect(result.ok && result.config.apiUrl).toBe('');
  });

  it('aggregates every missing or invalid key with its description and env vars', () => {
    const result = loadConfig(shape, {runtime: {API_URL: 'not-a-url'}});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a config error');
    expect(result.errors).toEqual([
      {
        key: 'apiUrl',
        envVars: ['SHIPFOX_PUBLIC_API_URL', 'VITE_API_URL'],
        description: 'Base URL of the Shipfox API.',
        message: expect.any(String),
      },
      {
        key: 'datadogClientToken',
        envVars: ['SHIPFOX_PUBLIC_DATADOG_CLIENT_TOKEN', 'VITE_DATADOG_CLIENT_TOKEN'],
        description: 'Datadog RUM client token.',
        message: expect.any(String),
      },
    ]);
  });
});
