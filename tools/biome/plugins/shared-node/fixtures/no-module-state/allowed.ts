declare function processState<T>(key: string, init: () => T, moduleUrl: string): T;

const state = processState<{client?: object | undefined}>(
  'example/client/v1',
  () => ({}),
  import.meta.url,
);
const listeners = processState(
  'example/listeners/v1',
  () => new Set<() => void>(),
  import.meta.url,
);
const PROTOCOLS = new Set(['http:', 'https:']);

export function register(listener: () => void): boolean {
  let attempts = 0;
  for (let index = 0; index < 3; index += 1) attempts += index;
  state.client ??= {attempts};
  listeners.add(listener);
  const seen = new Set<string>();
  seen.add('local');
  return PROTOCOLS.has('http:');
}

export class Registry {
  static initialized = false;

  static {
    let ready = true;
    ready = !ready;
    Registry.initialized = ready;
  }

  isReady(): boolean {
    return Registry.initialized;
  }
}
