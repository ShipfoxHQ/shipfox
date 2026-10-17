import {recordCopy} from './registry.js';

/**
 * Returns the process-wide state stored under `key`, creating it with `init` on first use.
 * Copies of a package installed more than once share the value instead of holding their own.
 *
 * Put the state-shape version in the key, such as `@shipfox/node-temporal/client/v1`, and bump
 * it when the shape changes so copies with different shapes never share a slot.
 * Pass `import.meta.url` as `moduleUrl` so the call is attributed to the package copy that made it.
 *
 * Do not call it from code that Temporal workflows import. Workflows run in a sandbox with its
 * own `globalThis`.
 */
export function processState<T>(key: string, init: () => T, moduleUrl: string): T {
  recordCopy({slotKey: key, moduleUrl});
  const slot = Symbol.for(key);
  const store = globalThis as unknown as Record<symbol, T>;
  if (!(slot in store)) store[slot] = init();
  return store[slot] as T;
}
