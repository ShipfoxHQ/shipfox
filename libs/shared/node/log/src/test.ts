import {type Level, pino} from 'pino';

/**
 * Builds a pino logger that captures every emitted line into an in-memory
 * array instead of writing it out. Use it in tests to assert on log output,
 * for example that a secret never reaches the logs.
 *
 * @param level - Lowest level to capture. Defaults to `trace` so nothing is dropped.
 */
export function createCapturingLogger(level: Level = 'trace') {
  const lines: string[] = [];
  const logger = pino({level}, {write: (line) => void lines.push(line)});
  return {
    logger,
    lines,
    clear: () => {
      lines.length = 0;
    },
  };
}

export type CapturingLogger = ReturnType<typeof createCapturingLogger>;
