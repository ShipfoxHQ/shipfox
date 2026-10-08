import type {
  EvaluationContext,
  JsonValue,
  Provider,
  ResolutionDetails,
} from '@openfeature/server-sdk';
import {defineFlags} from '@shipfox/feature-flags';
import {z} from 'zod';
import {createFeatureFlags} from './feature-flags.js';
import {createTestFeatureFlags} from './testing.js';

const mocks = vi.hoisted(() => ({warn: vi.fn()}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: mocks.warn})}));

const flags = defineFlags({
  'sample-switch': {kind: 'boolean', default: false, desc: 'A sample switch.'},
  'sample-mode': {
    kind: 'config',
    schema: z.enum(['off', 'shadow', 'enforce']),
    default: 'off',
    desc: 'A sample mode.',
  },
});

interface FakeProviderOptions {
  values?: Record<string, unknown>;
  fail?: Error;
}

function createFakeProvider(options: FakeProviderOptions = {}) {
  const contexts: EvaluationContext[] = [];
  function resolve<T>(key: string, defaultValue: T, context: EvaluationContext) {
    contexts.push(context);
    if (options.fail) throw options.fail;
    if (!options.values || !(key in options.values)) {
      return {
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'FLAG_NOT_FOUND',
      } as ResolutionDetails<T>;
    }
    return {value: options.values[key] as T, reason: 'STATIC'} as ResolutionDetails<T>;
  }
  const provider: Provider = {
    metadata: {name: 'fake'},
    runsOn: 'server',
    resolveBooleanEvaluation: (key, defaultValue, context) =>
      Promise.resolve(resolve(key, defaultValue, context)),
    resolveStringEvaluation: (key, defaultValue, context) =>
      Promise.resolve(resolve(key, defaultValue, context)),
    resolveNumberEvaluation: (key, defaultValue, context) =>
      Promise.resolve(resolve(key, defaultValue, context)),
    resolveObjectEvaluation: <T extends JsonValue>(
      key: string,
      defaultValue: T,
      context: EvaluationContext,
    ) => Promise.resolve(resolve(key, defaultValue, context)),
  };
  return {provider, contexts};
}

describe('createFeatureFlags', () => {
  beforeEach(() => {
    mocks.warn.mockClear();
  });

  describe('with no provider', () => {
    test('returns the code defaults', async () => {
      const featureFlags = createFeatureFlags({env: {}});

      expect(await featureFlags.boolean(flags['sample-switch'], {workspaceId: 'w1'})).toBe(false);
      expect(await featureFlags.config(flags['sample-mode'])).toBe('off');
    });
  });

  describe('env overrides', () => {
    test('a boolean override wins over the default', async () => {
      const featureFlags = createFeatureFlags({env: {FLAG_SAMPLE_SWITCH: 'true'}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(true);
    });

    test('a config override takes JSON', async () => {
      const featureFlags = createFeatureFlags({env: {FLAG_SAMPLE_MODE: '"enforce"'}});

      expect(await featureFlags.config(flags['sample-mode'])).toBe('enforce');
    });

    test('an override wins over the provider', async () => {
      const {provider} = createFakeProvider({values: {'sample-switch': false}});
      const featureFlags = createFeatureFlags({provider, env: {FLAG_SAMPLE_SWITCH: 'true'}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(true);
    });

    test('an empty variable is not an override', async () => {
      const featureFlags = createFeatureFlags({env: {FLAG_SAMPLE_SWITCH: ''}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(false);
      expect(() => featureFlags.validate([flags['sample-switch']])).not.toThrow();
    });

    test('an invalid override is ignored at read time and logged once', async () => {
      const featureFlags = createFeatureFlags({env: {FLAG_SAMPLE_SWITCH: 'yes'}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(false);
      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(false);
      expect(mocks.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('with a provider', () => {
    test('returns the provider value', async () => {
      const {provider} = createFakeProvider({
        values: {'sample-switch': true, 'sample-mode': 'shadow'},
      });
      const featureFlags = createFeatureFlags({provider, env: {}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(true);
      expect(await featureFlags.config(flags['sample-mode'])).toBe('shadow');
    });

    test('passes the subject to the provider', async () => {
      const {provider, contexts} = createFakeProvider({values: {'sample-switch': true}});
      const featureFlags = createFeatureFlags({provider, env: {}});

      await featureFlags.boolean(flags['sample-switch'], {
        userId: 'u1',
        email: 'a@b.test',
        workspaceId: 'w1',
      });
      await featureFlags.boolean(flags['sample-switch'], {workspaceId: 'w2'});

      expect(contexts[0]).toEqual({
        targetingKey: 'u1',
        userId: 'u1',
        email: 'a@b.test',
        workspaceId: 'w1',
      });
      expect(contexts[1]).toEqual({targetingKey: 'workspace:w2', workspaceId: 'w2'});
    });

    test('serves the default and logs once when the flag is unknown to the provider', async () => {
      const {provider} = createFakeProvider({values: {}});
      const featureFlags = createFeatureFlags({provider, env: {}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(false);
      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(false);
      expect(await featureFlags.config(flags['sample-mode'])).toBe('off');
      expect(mocks.warn).toHaveBeenCalledTimes(2);
    });

    test('serves the default when the config value fails the schema', async () => {
      const {provider} = createFakeProvider({values: {'sample-mode': 'maybe'}});
      const featureFlags = createFeatureFlags({provider, env: {}});

      expect(await featureFlags.config(flags['sample-mode'])).toBe('off');
      expect(mocks.warn).toHaveBeenCalledTimes(1);
    });

    test('a failing provider never throws', async () => {
      const {provider} = createFakeProvider({fail: new Error('boom')});
      const featureFlags = createFeatureFlags({provider, env: {}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(false);
      expect(await featureFlags.config(flags['sample-mode'])).toBe('off');
    });

    test('serves defaults while the provider is not ready', async () => {
      const {provider} = createFakeProvider({values: {'sample-switch': true}});
      let release: () => void = () => undefined;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slowProvider: Provider = Object.assign(Object.create(provider), {
        initialize: () => ready,
      });
      const featureFlags = createFeatureFlags({provider: slowProvider, env: {}});

      expect(await featureFlags.boolean(flags['sample-switch'])).toBe(false);

      release();
      await vi.waitFor(async () => {
        expect(await featureFlags.boolean(flags['sample-switch'])).toBe(true);
      });
    });
  });

  describe('validate', () => {
    test('accepts unique definitions with valid overrides', () => {
      const featureFlags = createFeatureFlags({
        env: {FLAG_SAMPLE_SWITCH: 'true', FLAG_SAMPLE_MODE: '"shadow"'},
      });

      expect(() =>
        featureFlags.validate([flags['sample-switch'], flags['sample-mode']]),
      ).not.toThrow();
    });

    test('rejects a duplicate key', () => {
      const featureFlags = createFeatureFlags({env: {}});

      expect(() =>
        featureFlags.validate([flags['sample-switch'], {...flags['sample-switch']}]),
      ).toThrow('Flag key "sample-switch" is declared more than once');
    });

    test('rejects every invalid override and names the variable', () => {
      const featureFlags = createFeatureFlags({
        env: {FLAG_SAMPLE_SWITCH: 'yes', FLAG_SAMPLE_MODE: '"maybe"'},
      });

      const validate = () => featureFlags.validate([flags['sample-switch'], flags['sample-mode']]);

      expect(validate).toThrow('FLAG_SAMPLE_SWITCH is invalid');
      expect(validate).toThrow('FLAG_SAMPLE_MODE is invalid');
    });
  });
});

describe('createTestFeatureFlags', () => {
  test('returns listed values and defaults for the rest', async () => {
    const featureFlags = createTestFeatureFlags({'sample-switch': true});

    expect(await featureFlags.boolean(flags['sample-switch'])).toBe(true);
    expect(await featureFlags.config(flags['sample-mode'])).toBe('off');
  });

  test('fails loudly on a listed value that does not match the flag', () => {
    const featureFlags = createTestFeatureFlags({'sample-mode': 'maybe'});

    expect(() => featureFlags.config(flags['sample-mode'])).toThrow('is invalid');
  });

  test('validates duplicate keys', () => {
    expect(() =>
      createTestFeatureFlags().validate([flags['sample-switch'], flags['sample-switch']]),
    ).toThrow('more than once');
  });
});
