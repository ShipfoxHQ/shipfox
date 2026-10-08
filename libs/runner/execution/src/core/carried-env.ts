import {delimiter, resolve} from 'node:path';
import {ENV_FILE, parseStepOutput, StepOutputError} from '#core/step-output.js';

/**
 * What a step handed to the steps after it: environment variables from `$SHIPFOX_ENV` and
 * directories from `$SHIPFOX_PATH`. Directories are absolute, in the order the step wrote them.
 */
export interface CarriedEnv {
  readonly env: Readonly<Record<string, string>>;
  readonly path: readonly string[];
}

export const EMPTY_CARRIED_ENV: CarriedEnv = {env: {}, path: []};

const RESERVED_ENV_PREFIX = 'SHIPFOX_';
const LINE_SPLIT_REGEX = /\r?\n/;

export function parseCarriedEnv(raw: string): Record<string, string> {
  const env = parseStepOutput(raw, ENV_FILE);
  for (const name of Object.keys(env)) {
    if (name === 'PATH') {
      throw new StepOutputError(
        'Env file cannot set "PATH". Write the directories to $SHIPFOX_PATH instead.',
      );
    }
    if (name.startsWith(RESERVED_ENV_PREFIX)) {
      throw new StepOutputError(
        `Env file cannot set "${name}". Names starting with ${RESERVED_ENV_PREFIX} are reserved.`,
      );
    }
  }
  return env;
}

/** One directory per line. A relative directory resolves against `cwd`. */
export function parseCarriedPath(raw: string, cwd: string): string[] {
  return raw
    .split(LINE_SPLIT_REGEX)
    .filter((line) => line.trim() !== '')
    .map((line) => resolve(cwd, line));
}

/**
 * Stacks the carried env of steps in the order they ran. A later step overrides an earlier
 * value, and its directories come first on `PATH`.
 */
export function mergeCarriedEnv(entries: readonly CarriedEnv[]): CarriedEnv {
  const env: Record<string, string> = {};
  const path: string[] = [];
  for (const entry of entries) {
    Object.assign(env, entry.env);
    for (const directory of entry.path) {
      const existing = path.indexOf(directory);
      if (existing !== -1) path.splice(existing, 1);
      path.unshift(directory);
    }
  }
  return {env, path};
}

export function prependPath(directories: readonly string[], current: string | undefined): string {
  return [...directories, ...(current ? [current] : [])].join(delimiter);
}
