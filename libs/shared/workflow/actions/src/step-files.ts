import {appendFileSync} from 'node:fs';
import {ACTION_ENV, MIN_MASKED_VALUE_LENGTH} from '#contract.js';
import {formatOutputEntry} from '#outputs.js';

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV_PREFIX = 'SHIPFOX_';
const LINE_BREAK_RE = /[\r\n]/;
const LINE_SPLIT_RE = /\r?\n/;

/** Formats one entry of the `SHIPFOX_ENV` file. Rejects the names the runner fails a step for. */
export function formatEnvEntry(name: string, value: string): string {
  if (typeof name !== 'string' || !ENV_NAME_RE.test(name)) {
    throw new Error(`setEnv got an invalid variable name: ${JSON.stringify(name)}.`);
  }
  if (name === 'PATH') throw new Error('setEnv cannot set "PATH". Use addPath instead.');
  if (name.startsWith(RESERVED_ENV_PREFIX)) {
    throw new Error(
      `setEnv cannot set "${name}". Names starting with ${RESERVED_ENV_PREFIX} are reserved.`,
    );
  }
  if (typeof value !== 'string') {
    throw new Error(`setEnv needs a string value for "${name}", but got ${typeof value}.`);
  }
  return formatOutputEntry(name, value, ACTION_ENV.env);
}

/** Formats one entry of the `SHIPFOX_PATH` file. */
export function formatPathEntry(directory: string): string {
  if (typeof directory !== 'string' || directory.trim() === '' || LINE_BREAK_RE.test(directory)) {
    throw new Error('addPath needs one directory, without line breaks.');
  }
  return `${directory}\n`;
}

/**
 * Formats the `SHIPFOX_MASK` lines of one value. The runner masks a multi-line value line by
 * line, so each line long enough to mask gets its own entry. The errors never quote the value.
 */
export function formatMaskEntries(value: string): string {
  if (typeof value !== 'string')
    throw new Error(`addMask needs a string, but got ${typeof value}.`);
  const maskable = value
    .split(LINE_SPLIT_RE)
    .filter((line) => line.trim() !== '' && [...line].length >= MIN_MASKED_VALUE_LENGTH);
  if (maskable.length === 0) {
    throw new Error(
      `addMask needs a value of at least ${MIN_MASKED_VALUE_LENGTH} characters. A shorter value would hide ordinary text in the logs.`,
    );
  }
  return maskable.map((line) => `${line}\n`).join('');
}

export interface StepFilePaths {
  readonly env: string | undefined;
  readonly path: string | undefined;
  readonly mask: string | undefined;
}

export interface StepFiles {
  setEnv(name: string, value: string): void;
  addPath(directory: string): void;
  addMask(value: string): void;
}

/** Appends to the files right away, so the values survive a later throw. */
export function createStepFiles(paths: StepFilePaths): StepFiles {
  return {
    setEnv: (name, value) =>
      append({helper: 'setEnv', variable: ACTION_ENV.env, path: paths.env}, () =>
        formatEnvEntry(name, value),
      ),
    addPath: (directory) =>
      append({helper: 'addPath', variable: ACTION_ENV.path, path: paths.path}, () =>
        formatPathEntry(directory),
      ),
    addMask: (value) =>
      append({helper: 'addMask', variable: ACTION_ENV.mask, path: paths.mask}, () =>
        formatMaskEntries(value),
      ),
  };
}

function append(
  target: {helper: string; variable: string; path: string | undefined},
  entry: () => string,
): void {
  // An older runner does not set the variable.
  if (!target.path) {
    throw new Error(
      `${target.variable} is not set, so ${target.helper} cannot work. Update the runner.`,
    );
  }
  appendFileSync(target.path, entry());
}
