import {
  type EvaluationContext,
  type JsonValue,
  OpenFeature,
  type Provider,
} from '@openfeature/server-sdk';
import {
  type BooleanFlagDefinition,
  type ConfigFlagDefinition,
  checkFlagValue,
  type FlagDefinition,
  type FlagSubject,
  findDuplicateFlagKeys,
  flagEnvName,
  parseFlagOverride,
} from '@shipfox/feature-flags';
import {logger} from '@shipfox/node-opentelemetry';

export type {Provider};

export interface FeatureFlags {
  /** Reads a boolean flag. Never throws; any failure returns the code default. */
  boolean(definition: BooleanFlagDefinition, subject?: FlagSubject): Promise<boolean>;
  /** Reads a config flag. Never throws; any failure or schema mismatch returns the code default. */
  config<Value>(definition: ConfigFlagDefinition<Value>, subject?: FlagSubject): Promise<Value>;
  /**
   * Startup check for the flags a composition declares. Throws on a duplicate
   * key or an invalid `FLAG_*` override. The instance keeps no record of the
   * definitions.
   */
  validate(definitions: readonly FlagDefinition[]): void;
}

export interface CreateFeatureFlagsOptions {
  /** Answers flag reads after env overrides. Without one, reads return code defaults. */
  provider?: Provider | undefined;
  /** Where `FLAG_*` overrides are read. Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
}

type ProviderClient = ReturnType<typeof OpenFeature.getClient>;

let instanceCount = 0;

/**
 * Creates the one flag reader a composition root hands to its modules.
 * Resolution order: `FLAG_*` env override, provider, code default.
 *
 * OpenFeature stays inside this package. The provider is set without waiting,
 * so reads return defaults until it is ready.
 */
export function createFeatureFlags(options: CreateFeatureFlagsOptions = {}): FeatureFlags {
  const env = options.env ?? process.env;
  const overrides = new Map<string, {value: unknown} | undefined>();
  const reported = new Set<string>();
  const client = createClient(options.provider);

  function reportOnce(key: string, reason: string, message: string) {
    const id = `${key}\u0000${reason}`;
    if (reported.has(id)) return;
    reported.add(id);
    logger().warn({flag: key, reason}, message);
  }

  function readOverride(definition: FlagDefinition): {value: unknown} | undefined {
    if (overrides.has(definition.key)) return overrides.get(definition.key);
    const envName = flagEnvName(definition.key);
    const raw = env[envName];
    let override: {value: unknown} | undefined;
    if (raw !== undefined && raw.trim() !== '') {
      const parsed = parseFlagOverride(definition, raw);
      if (parsed.ok) {
        override = {value: parsed.value};
      } else {
        reportOnce(
          definition.key,
          'invalid-override',
          `Ignoring invalid ${envName}: ${parsed.reason}`,
        );
      }
    }
    overrides.set(definition.key, override);
    return override;
  }

  async function resolveFromProvider(
    providerClient: ProviderClient,
    definition: FlagDefinition,
    subject: FlagSubject,
  ): Promise<unknown> {
    const context = toEvaluationContext(subject);
    const details =
      definition.kind === 'boolean'
        ? await providerClient.getBooleanDetails(definition.key, definition.default, context)
        : await providerClient.getObjectDetails(
            definition.key,
            definition.default as JsonValue,
            context,
          );
    if (details.errorCode !== undefined) {
      reportOnce(
        definition.key,
        details.errorCode,
        `Flag provider could not answer, serving the default: ${details.errorMessage ?? details.errorCode}`,
      );
      return definition.default;
    }
    const checked = checkFlagValue(definition, details.value);
    if (!checked.ok) {
      reportOnce(
        definition.key,
        'invalid-value',
        `Flag provider returned an invalid value, serving the default: ${checked.reason}`,
      );
      return definition.default;
    }
    return checked.value;
  }

  async function read(definition: FlagDefinition, subject: FlagSubject): Promise<unknown> {
    try {
      const override = readOverride(definition);
      if (override !== undefined) return override.value;
      if (client === undefined) return definition.default;
      return await resolveFromProvider(client, definition, subject);
    } catch (error) {
      reportOnce(
        definition.key,
        'read-failed',
        `Flag read failed, serving the default: ${error instanceof Error ? error.message : String(error)}`,
      );
      return definition.default;
    }
  }

  return {
    boolean: async (definition, subject = {}) => (await read(definition, subject)) as boolean,
    config: async <Value>(definition: ConfigFlagDefinition<Value>, subject: FlagSubject = {}) =>
      (await read(definition, subject)) as Value,
    validate: (definitions) => {
      const problems: string[] = [];
      for (const key of findDuplicateFlagKeys(definitions)) {
        problems.push(`Flag key "${key}" is declared more than once.`);
      }
      for (const definition of definitions) {
        const envName = flagEnvName(definition.key);
        const raw = env[envName];
        if (raw === undefined || raw.trim() === '') continue;
        const parsed = parseFlagOverride(definition, raw);
        if (!parsed.ok) problems.push(`${envName} is invalid: ${parsed.reason}.`);
      }
      if (problems.length > 0) {
        throw new Error(`Invalid feature flag setup:\n${problems.map((p) => `- ${p}`).join('\n')}`);
      }
    },
  };
}

function createClient(provider: Provider | undefined) {
  if (provider === undefined) return undefined;
  // One OpenFeature domain per instance keeps the SDK's global registry private
  // and lets tests create several instances.
  instanceCount += 1;
  const domain = `shipfox-feature-flags-${instanceCount}`;
  OpenFeature.setProvider(domain, provider);
  return OpenFeature.getClient(domain);
}

function toEvaluationContext(subject: FlagSubject): EvaluationContext {
  const context: Record<string, string> = {};
  if (subject.userId !== undefined) context.userId = subject.userId;
  if (subject.email !== undefined) context.email = subject.email;
  if (subject.workspaceId !== undefined) context.workspaceId = subject.workspaceId;
  if (subject.anonymousId !== undefined) context.anonymousId = subject.anonymousId;
  const targetingKey =
    subject.userId ??
    subject.anonymousId ??
    (subject.workspaceId === undefined ? undefined : `workspace:${subject.workspaceId}`);
  return targetingKey === undefined ? context : {...context, targetingKey};
}
