import {
  type CleanedEnv,
  cleanEnv,
  type OptionalValidatorSpec,
  type RequiredValidatorSpec,
} from 'envalid';

export type {
  BaseValidator,
  CleanedEnv,
  CleanedEnvAccessors,
  CleanOptions,
  ExactValidator,
  OptionalValidatorSpec,
  ReporterOptions,
  RequiredValidatorSpec,
} from 'envalid';
export {bool, cleanEnv, email, host, num, port, str, url} from 'envalid';

type ConfigValue<Validator> =
  Validator extends OptionalValidatorSpec<infer Value>
    ? Value | undefined
    : Validator extends RequiredValidatorSpec<infer Value>
      ? Value
      : never;

type InvalidFallbackKeys<Schema extends Record<string, unknown>> = {
  [Key in keyof Schema]: Schema[Key] extends {
    readonly fallbackTo: infer Dependency extends PropertyKey;
  }
    ? Dependency extends keyof Schema
      ? ConfigValue<Schema[Dependency]> extends ConfigValue<Schema[Key]>
        ? never
        : Key
      : Key
    : never;
}[keyof Schema];

type ValidFallbackSchema<Schema extends Record<string, unknown>> = [
  InvalidFallbackKeys<Schema>,
] extends [never]
  ? unknown
  : never;

type FallbackValidatorSpec<Validator extends object, Dependency extends string> = Validator & {
  readonly fallbackTo: Dependency;
};

/**
 * Uses another validated configuration value when this value is not set.
 * The dependency must be present in the same schema and produce a compatible value.
 */
export function fallbackTo<const Dependency extends string, const Validator extends object>(
  dependency: Dependency,
  validator: Validator,
): FallbackValidatorSpec<Validator, Dependency> {
  return {...validator, fallbackTo: dependency};
}

export function createConfig<Schema extends Record<string, unknown>>(
  schema: Schema & ValidFallbackSchema<Schema>,
  update?: Partial<NodeJS.ProcessEnv>,
): CleanedEnv<Schema> {
  const environment: Record<string, unknown> = {...process.env, ...update};
  const fallbackOrder = validateFallbackGraph(schema);
  if (fallbackOrder.length === 0) return cleanEnv(environment, schema);

  const preflightSchema = createPreflightSchema(schema);
  const preflightConfig = cleanEnv(environment, preflightSchema) as unknown as Record<
    string,
    unknown
  >;
  const fallbackInputs: Record<string, unknown> = {};
  const resolvedFallbacks = new Map<string, unknown>();

  for (const key of fallbackOrder) {
    if (environment[key] !== undefined) continue;

    const validator = schema[key];
    if (validator === undefined) {
      throw new Error(`Configuration fallback key "${key}" is missing from the schema.`);
    }

    const dependency = getFallbackDependency(validator);
    if (dependency === undefined) continue;

    const dependencyValue = resolvedFallbacks.has(dependency)
      ? resolvedFallbacks.get(dependency)
      : preflightConfig[dependency];
    if (dependencyValue === undefined) continue;

    fallbackInputs[key] = dependencyValue;
    resolvedFallbacks.set(
      key,
      validateFallbackValue(key, dependencyValue, environment.NODE_ENV, validator),
    );
  }

  return cleanEnv({...environment, ...fallbackInputs}, schema);
}

function validateFallbackGraph<Schema extends Record<string, unknown>>(schema: Schema): string[] {
  const dependencies = new Map<string, string>();

  for (const [key, validator] of Object.entries(schema)) {
    const dependency = getFallbackDependency(validator);
    if (dependency === undefined) continue;

    if (!Object.hasOwn(schema, dependency)) {
      throw new Error(
        `Configuration fallback for "${key}" references missing key "${dependency}".`,
      );
    }
    if (hasDefault(validator)) {
      throw new Error(`Configuration key "${key}" cannot declare both a fallback and a default.`);
    }

    dependencies.set(key, dependency);
  }

  return orderFallbacks(dependencies);
}

function orderFallbacks(dependencies: ReadonlyMap<string, string>): string[] {
  const ordered: string[] = [];
  const path: string[] = [];
  const states = new Map<string, 'visiting' | 'visited'>();

  function visit(key: string): void {
    const state = states.get(key);
    if (state === 'visited') return;
    if (state === 'visiting') {
      const cycleStart = path.indexOf(key);
      const cycle = [...path.slice(cycleStart), key];
      throw new Error(`Configuration fallback cycle detected: ${cycle.join(' -> ')}.`);
    }

    states.set(key, 'visiting');
    path.push(key);

    const dependency = dependencies.get(key);
    if (dependency !== undefined && dependencies.has(dependency)) visit(dependency);

    path.pop();
    states.set(key, 'visited');
    ordered.push(key);
  }

  for (const key of dependencies.keys()) visit(key);
  return ordered;
}

function createPreflightSchema<Schema extends Record<string, unknown>>(
  schema: Schema,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema).map(([key, validator]) => {
      if (getFallbackDependency(validator) === undefined) return [key, validator];

      return [key, {...(validator as object), default: undefined, requiredWhen: undefined}];
    }),
  );
}

function validateFallbackValue(
  key: string,
  value: unknown,
  nodeEnv: unknown,
  validator: unknown,
): unknown {
  try {
    const resolved = cleanEnv(
      {NODE_ENV: nodeEnv, [key]: value},
      {[key]: validator},
      {reporter: null},
    ) as unknown as Record<string, unknown>;
    return resolved[key];
  } catch {
    return value;
  }
}

function getFallbackDependency(validator: unknown): string | undefined {
  if (typeof validator !== 'object' || validator === null) return undefined;

  const fallbackTo = (validator as {fallbackTo?: unknown}).fallbackTo;
  if (fallbackTo === undefined) return undefined;
  if (typeof fallbackTo !== 'string' || fallbackTo.length === 0) {
    throw new Error('Configuration fallback keys must be non-empty strings.');
  }
  return fallbackTo;
}

function hasDefault(validator: unknown): boolean {
  if (typeof validator !== 'object' || validator === null) return false;

  return ['default', 'devDefault', 'testDefault'].some((key) => Object.hasOwn(validator, key));
}
