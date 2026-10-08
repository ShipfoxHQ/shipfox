import {
  type ConfigFlagDefinition,
  checkFlagValue,
  type FlagDefinition,
  findDuplicateFlagKeys,
} from '@shipfox/feature-flags';
import type {FeatureFlags} from './feature-flags.js';

/**
 * A fake for unit and route tests. Listed flags return their value; unlisted
 * flags return their code default. A listed value that fails the flag's kind or
 * schema throws when it is read, so a typo in a test fails loudly.
 *
 * ```ts
 * const flags = createTestFeatureFlags({'definitions-actions': true});
 * ```
 */
export function createTestFeatureFlags(
  values: Readonly<Record<string, unknown>> = {},
): FeatureFlags {
  function read(definition: FlagDefinition): unknown {
    if (!Object.hasOwn(values, definition.key)) return definition.default;
    const checked = checkFlagValue(definition, values[definition.key]);
    if (!checked.ok) {
      throw new Error(`Test value for flag "${definition.key}" is invalid: ${checked.reason}`);
    }
    return checked.value;
  }

  return {
    boolean: (definition) => Promise.resolve(read(definition) as boolean),
    config: <Value>(definition: ConfigFlagDefinition<Value>) =>
      Promise.resolve(read(definition) as Value),
    validate: (definitions) => {
      const duplicates = findDuplicateFlagKeys(definitions);
      if (duplicates.length > 0) {
        throw new Error(`Flag key "${duplicates[0]}" is declared more than once.`);
      }
    },
  };
}
