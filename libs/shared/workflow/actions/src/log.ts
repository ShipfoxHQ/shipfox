export interface ActionLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Wraps `fn`'s log lines in a collapsible `::group::` section, even when `fn` throws. */
  group<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
}

export interface ActionLogWriters {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processWriters: ActionLogWriters = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export function createActionLog(writers: ActionLogWriters = processWriters): ActionLog {
  return {
    info: (message) => writers.stdout(`${message}\n`),
    warn: (message) => writers.stderr(`warning: ${message}\n`),
    error: (message) => writers.stderr(`error: ${message}\n`),
    async group(name, fn) {
      // A marker only counts when it fills one whole line.
      writers.stdout(`::group::${name.replace(/[\r\n]+/g, ' ')}\n`);
      try {
        return await fn();
      } finally {
        writers.stdout('::endgroup::\n');
      }
    },
  };
}
