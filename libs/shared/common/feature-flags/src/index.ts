import type {z} from 'zod';

/** Who a flag is evaluated for. Every field is optional; an empty subject is global. */
export interface FlagSubject {
  userId?: string | undefined;
  email?: string | undefined;
  workspaceId?: string | undefined;
  anonymousId?: string | undefined;
}

interface FlagDefinitionBase<Key extends string> {
  readonly key: Key;
  /** Plain-language meaning of the flag. It also describes the `FLAG_*` override. */
  readonly desc: string;
  /** The web client may read this flag. Server-only flags never leave the API. */
  readonly client?: boolean | undefined;
}

export interface BooleanFlagDefinition<Key extends string = string>
  extends FlagDefinitionBase<Key> {
  readonly kind: 'boolean';
  readonly default: boolean;
}

export interface ConfigFlagDefinition<Value = unknown, Key extends string = string>
  extends FlagDefinitionBase<Key> {
  readonly kind: 'config';
  readonly schema: z.ZodType<Value>;
  readonly default: Value;
}

// biome-ignore lint/suspicious/noExplicitAny: a definition list holds config flags of every value type
export type FlagDefinition = BooleanFlagDefinition | ConfigFlagDefinition<any>;

type FlagSpec =
  | Omit<BooleanFlagDefinition, 'key'>
  // biome-ignore lint/suspicious/noExplicitAny: a spec list holds config flags of every value type
  | Omit<ConfigFlagDefinition<any>, 'key'>;

export type DefinedFlags<Specs extends Record<string, FlagSpec>> = {
  readonly [Key in keyof Specs & string]: Specs[Key] & {readonly key: Key};
};

export type FlagValueCheck<Value> = {ok: true; value: Value} | {ok: false; reason: string};

export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const FLAG_ENV_PREFIX = 'FLAG_';

/**
 * Declares the flags a package reads. The key of each entry becomes the
 * definition's `key`, so a read takes one object that carries the key, the
 * default, and the schema.
 *
 * Throws on a malformed key or a default that does not satisfy its kind, so a
 * bad declaration fails when the module is imported.
 */
export function defineFlags<const Specs extends Record<string, FlagSpec>>(
  specs: Specs,
): DefinedFlags<Specs> {
  const defined: Record<string, FlagDefinition> = {};
  for (const [key, spec] of Object.entries(specs)) {
    if (!FLAG_KEY_PATTERN.test(key)) {
      throw new Error(`Flag key "${key}" must be kebab-case, such as "definitions-actions".`);
    }
    const definition = {...spec, key} as FlagDefinition;
    const check = checkFlagValue(definition, definition.default);
    if (!check.ok) {
      throw new Error(`Flag "${key}" has an invalid default: ${check.reason}`);
    }
    defined[key] = definition;
  }
  return defined as unknown as DefinedFlags<Specs>;
}

/** The environment variable that overrides a flag: `FLAG_` plus the key in upper snake case. */
export function flagEnvName(key: string): string {
  return `${FLAG_ENV_PREFIX}${key.toUpperCase().replaceAll('-', '_')}`;
}

/** Checks a value against the flag's kind, and against its schema for a config flag. */
export function checkFlagValue(
  definition: BooleanFlagDefinition,
  value: unknown,
): FlagValueCheck<boolean>;
export function checkFlagValue<Value>(
  definition: ConfigFlagDefinition<Value>,
  value: unknown,
): FlagValueCheck<Value>;
export function checkFlagValue(definition: FlagDefinition, value: unknown): FlagValueCheck<unknown>;
export function checkFlagValue(
  definition: FlagDefinition,
  value: unknown,
): FlagValueCheck<unknown> {
  if (definition.kind === 'boolean') {
    return typeof value === 'boolean'
      ? {ok: true, value}
      : {ok: false, reason: 'expected a boolean'};
  }
  const parsed = definition.schema.safeParse(value);
  return parsed.success
    ? {ok: true, value: parsed.data}
    : {ok: false, reason: parsed.error.issues.map((issue) => issue.message).join('; ')};
}

/**
 * Parses the text of a `FLAG_*` variable. A boolean flag takes `true` or
 * `false`. A config flag takes JSON, so a string value is quoted:
 * `FLAG_LIMITS_CONCURRENCY_ENFORCEMENT='"enforce"'`.
 */
export function parseFlagOverride(
  definition: BooleanFlagDefinition,
  raw: string,
): FlagValueCheck<boolean>;
export function parseFlagOverride<Value>(
  definition: ConfigFlagDefinition<Value>,
  raw: string,
): FlagValueCheck<Value>;
export function parseFlagOverride(definition: FlagDefinition, raw: string): FlagValueCheck<unknown>;
export function parseFlagOverride(
  definition: FlagDefinition,
  raw: string,
): FlagValueCheck<unknown> {
  const text = raw.trim();
  if (definition.kind === 'boolean') {
    if (text === 'true') return {ok: true, value: true};
    if (text === 'false') return {ok: true, value: false};
    return {ok: false, reason: 'use true or false'};
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {ok: false, reason: 'use a JSON value, and quote a string value'};
  }
  return checkFlagValue(definition, json);
}

/** Returns each key that more than one definition declares. */
export function findDuplicateFlagKeys(definitions: readonly {key: string}[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const {key} of definitions) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}
