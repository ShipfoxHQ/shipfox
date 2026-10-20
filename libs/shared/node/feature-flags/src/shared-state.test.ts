import type {Provider, ResolutionDetails} from '@openfeature/server-sdk';
import {defineFlags} from '@shipfox/feature-flags';

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: vi.fn()})}));

const SHARED_KEYS = [
  '@shipfox/node-process-state/registry/v1',
  '@shipfox/node-feature-flags/openfeature-domains/v1',
];

const flags = defineFlags({
  'sample-switch': {kind: 'boolean', default: false, desc: 'A sample switch.'},
});

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

function staticProvider(value: boolean): Provider {
  const resolve = <T>() => Promise.resolve({value, reason: 'STATIC'} as ResolutionDetails<T>);
  return {
    metadata: {name: 'static'},
    runsOn: 'server',
    resolveBooleanEvaluation: resolve,
    resolveStringEvaluation: resolve,
    resolveNumberEvaluation: resolve,
    resolveObjectEvaluation: resolve,
  };
}

async function loadCopy() {
  vi.resetModules();
  return await import('./feature-flags.js');
}

describe('state shared between module instances', () => {
  beforeEach(clearSharedState);
  afterEach(clearSharedState);

  it('keeps the provider of each instance when both create a flag reader', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    const firstFlags = first.createFeatureFlags({provider: staticProvider(true), env: {}});
    const secondFlags = second.createFeatureFlags({provider: staticProvider(false), env: {}});

    await expect(firstFlags.boolean(flags['sample-switch'])).resolves.toBe(true);
    await expect(secondFlags.boolean(flags['sample-switch'])).resolves.toBe(false);
  });
});
