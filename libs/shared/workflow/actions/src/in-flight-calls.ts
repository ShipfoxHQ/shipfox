import type {AliasTools, Tools} from '#tools-client.js';

export interface InFlightCalls {
  readonly tools: Tools;
  /** Labels (`alias.tool`) of the calls still running, one per call. */
  pending(): string[];
}

/** Wraps a tools client so the bootstrap can name the calls a handler left running. */
export function trackInFlightCalls(tools: Tools): InFlightCalls {
  const running = new Map<number, string>();
  const aliases = new Map<string, AliasTools>();
  let nextId = 0;

  async function track<T>(label: string, run: () => Promise<T>): Promise<T> {
    const id = nextId++;
    running.set(id, label);
    try {
      return await run();
    } finally {
      running.delete(id);
    }
  }

  const tracked = new Proxy({} as Tools, {
    get(_target, alias) {
      if (typeof alias !== 'string') return undefined;
      const inner = tools[alias];
      if (!inner) return inner;
      let wrapped = aliases.get(alias);
      if (!wrapped) {
        wrapped = {
          call: (tool, args, options) =>
            track(`${alias}.${tool}`, () => inner.call(tool, args, options)),
          download: (tool, args, options) =>
            track(`${alias}.${tool}`, () => inner.download(tool, args, options)),
        };
        aliases.set(alias, wrapped);
      }
      return wrapped;
    },
  });

  return {tools: tracked, pending: () => [...running.values()]};
}
