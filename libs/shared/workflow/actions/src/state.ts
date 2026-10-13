import {appendFileSync, readFileSync} from 'node:fs';
import {MAX_STATE_BYTES} from '#contract.js';

const STATE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface ActionState {
  /** Saves a value for the post phase of the same step. */
  set(name: string, value: string): void;
  /** Reads a value saved earlier in this phase or in the phase before it. */
  get(name: string): string | undefined;
}

export class ActionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionStateError';
  }
}

/** Reads a state file, one `{"name", "value"}` JSON line per entry. A later entry wins. */
export function parseStateFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split('\n')) {
    if (line === '') continue;
    const entry = JSON.parse(line) as {name: string; value: string};
    values.set(entry.name, entry.value);
  }
  return values;
}

/**
 * The state of one step. `get` answers from the file as it was at start and from values set in
 * this process, so a value set by the main entry is there for the post entry.
 */
export function createActionState(path: string | undefined): ActionState {
  const seed = path === undefined ? '' : readFileSync(path, 'utf8');
  const values = parseStateFile(seed);
  let bytes = Buffer.byteLength(seed);

  return {
    set(name, value) {
      if (path === undefined) {
        throw new ActionStateError('State is not available: the runner did not set SHIPFOX_STATE.');
      }
      if (!STATE_NAME_RE.test(name)) {
        throw new ActionStateError(`State name "${name}" must be an identifier.`);
      }
      if (typeof value !== 'string') {
        throw new ActionStateError(`State "${name}" must be a string, not ${typeof value}.`);
      }
      const line = `${JSON.stringify({name, value})}\n`;
      const nextBytes = bytes + Buffer.byteLength(line);
      if (nextBytes > MAX_STATE_BYTES) {
        throw new ActionStateError(`State is limited to ${MAX_STATE_BYTES} bytes.`);
      }
      appendFileSync(path, line);
      bytes = nextBytes;
      values.set(name, value);
    },
    get: (name) => values.get(name),
  };
}
