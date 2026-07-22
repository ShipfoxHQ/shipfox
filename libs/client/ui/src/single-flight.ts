export interface SingleFlightOptions {
  /** Number of settled outcomes to retain for remount deduplication. Defaults to 0. */
  maxTerminalResults?: number;
}

export interface SingleFlight<Key, Value> {
  run(key: Key, operation: () => Promise<Value>): Promise<Value>;
  clear(key?: Key): void;
  readonly inFlightSize: number;
  readonly terminalSize: number;
}

/**
 * Deduplicates concurrent work by key. Settled requests are always evicted from
 * the active map; callers can opt into a bounded LRU terminal cache when a short
 * remount window must not replay a single-use callback.
 */
export function createSingleFlight<Key, Value>({
  maxTerminalResults = 0,
}: SingleFlightOptions = {}): SingleFlight<Key, Value> {
  const inFlight = new Map<Key, Promise<Value>>();
  const terminal = new Map<Key, Promise<Value>>();

  const remember = (key: Key, result: Promise<Value>) => {
    if (maxTerminalResults <= 0) return;
    terminal.delete(key);
    terminal.set(key, result);
    while (terminal.size > maxTerminalResults) {
      const oldest = terminal.keys().next().value;
      if (oldest === undefined) return;
      terminal.delete(oldest);
    }
  };

  return {
    run(key, operation) {
      const retained = terminal.get(key);
      if (retained) {
        terminal.delete(key);
        terminal.set(key, retained);
        return retained;
      }
      const active = inFlight.get(key);
      if (active) return active;

      const result = Promise.resolve().then(operation);
      inFlight.set(key, result);
      const settle = () => {
        if (inFlight.get(key) === result) inFlight.delete(key);
        remember(key, result);
      };
      result.then(settle, settle);
      return result;
    },
    clear(key) {
      if (key === undefined) {
        inFlight.clear();
        terminal.clear();
      } else {
        inFlight.delete(key);
        terminal.delete(key);
      }
    },
    get inFlightSize() {
      return inFlight.size;
    },
    get terminalSize() {
      return terminal.size;
    },
  };
}
