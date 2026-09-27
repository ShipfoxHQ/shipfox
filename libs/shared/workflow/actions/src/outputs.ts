import {randomUUID} from 'node:crypto';
import type {ActionOutputDeclaration, ActionOutputDeclarations} from '#contract.js';

const LINE_BREAK_RE = /[\r\n]/;

export type ActionOutputValues = Readonly<Record<string, unknown>>;

export class ActionOutputError extends Error {
  readonly output: string | undefined;

  constructor(params: {message: string; output?: string; cause?: unknown}) {
    super(params.message, params.cause === undefined ? undefined : {cause: params.cause});
    this.name = 'ActionOutputError';
    this.output = params.output;
  }
}

/**
 * Encodes one output by its declared type, not its runtime value. The server parses a `json`
 * output with `JSON.parse`, so a `json` string is always stringified: `"true"` stays a string
 * instead of becoming a boolean.
 */
export function encodeOutputValue(params: {
  name: string;
  declaration: ActionOutputDeclaration | undefined;
  value: unknown;
}): string {
  const {name, declaration, value} = params;
  if (!declaration) {
    throw new ActionOutputError({
      output: name,
      message: `Output "${name}" is not declared in action.yml.`,
    });
  }

  switch (declaration.type) {
    case 'string':
      if (typeof value === 'string') return value;
      break;
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      break;
    case 'boolean':
      if (typeof value === 'boolean') return String(value);
      break;
    case 'json':
      return encodeJsonOutput(name, value);
  }
  throw typeMismatch({name, declaration, value});
}

/** Formats one entry of the `SHIPFOX_OUTPUT` file. Multi-line values use the heredoc form. */
export function formatOutputEntry(name: string, encoded: string): string {
  if (!LINE_BREAK_RE.test(encoded)) return `${name}=${encoded}\n`;
  const delimiter = `SHIPFOX_OUTPUT_${randomUUID()}`;
  return `${name}<<${delimiter}\n${encoded}\n${delimiter}\n`;
}

export interface ActionOutputs {
  /** Validates and encodes one output, and returns the file entry to append right away. */
  set(name: string, value: unknown): string;
  /**
   * Merges the handler's returned object over earlier `set` values, checks required outputs, and
   * returns the complete file content.
   */
  finish(returned: unknown): string;
}

export function createActionOutputs(declarations: ActionOutputDeclarations): ActionOutputs {
  const encoded = new Map<string, string>();

  const set = (name: string, value: unknown): string => {
    const declaration = Object.hasOwn(declarations, name) ? declarations[name] : undefined;
    const encodedValue = encodeOutputValue({name, declaration, value});
    encoded.set(name, encodedValue);
    return formatOutputEntry(name, encodedValue);
  };

  return {
    set,
    finish(returned) {
      for (const [name, value] of Object.entries(returnedOutputs(returned))) set(name, value);

      const missing = Object.entries(declarations)
        .filter(([name, declaration]) => declaration.required !== false && !encoded.has(name))
        .map(([name]) => name);
      if (missing.length > 0) throw missingRequired(missing);

      return [...encoded].map(([name, value]) => formatOutputEntry(name, value)).join('');
    },
  };
}

function returnedOutputs(returned: unknown): ActionOutputValues {
  if (returned === undefined) return {};
  if (isPlainObject(returned)) return returned;
  throw new ActionOutputError({
    message: 'The action handler must return an object of outputs, or nothing.',
  });
}

function encodeJsonOutput(name: string, value: unknown): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value, rejectNonFiniteNumbers);
  } catch (error) {
    throw new ActionOutputError({
      output: name,
      message: `Output "${name}" is declared as json but cannot be serialized: ${errorMessage(error)}`,
      cause: error,
    });
  }
  if (encoded === undefined) {
    throw new ActionOutputError({
      output: name,
      message: `Output "${name}" is declared as json but got ${describe(value)}.`,
    });
  }
  return encoded;
}

// JSON.stringify would silently turn these into null.
function rejectNonFiniteNumbers(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`${value} is not a JSON number`);
  }
  return value;
}

function typeMismatch(params: {
  name: string;
  declaration: ActionOutputDeclaration;
  value: unknown;
}): ActionOutputError {
  const {name, declaration, value} = params;
  return new ActionOutputError({
    output: name,
    message: `Output "${name}" is declared as ${declaration.type} but got ${describe(value)}.`,
  });
}

function missingRequired(names: readonly string[]): ActionOutputError {
  const list = names.map((name) => `"${name}"`).join(', ');
  const [first] = names;
  return new ActionOutputError({
    ...(names.length === 1 && first !== undefined ? {output: first} : {}),
    message:
      names.length === 1
        ? `Required output ${list} was not set.`
        : `Required outputs ${list} were not set.`,
  });
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return `a ${typeof value}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
