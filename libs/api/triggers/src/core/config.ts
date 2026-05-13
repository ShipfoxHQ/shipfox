import type {TriggerSubscription} from './entities/subscription.js';

/**
 * Returns the trigger's configured `with` block as a plain object, or
 * undefined when the field is absent or not an object. The projection is
 * stored as jsonb, so the field type at read time is `unknown` even
 * though the YAML parser writes a `Record<string, unknown>`. The narrow
 * runtime check keeps a corrupt projection (e.g. a future migration or
 * admin write) from leaking a non-object into `workflow_runs.inputs`.
 */
export function readConfigInputs(
  subscription: TriggerSubscription,
): Record<string, unknown> | undefined {
  const value = subscription.config.with;
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Returns the trigger's configured `on` filter as a string, an array of
 * strings, or undefined. Same trust-boundary reasoning as
 * `readConfigInputs`: the parser produces these shapes, but the
 * projection column is unconstrained jsonb and the matcher runs on the
 * hot integration-event path.
 */
export function readConfigOn(subscription: TriggerSubscription): string | string[] | undefined {
  const value = subscription.config.on;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value as string[];
  }
  return undefined;
}
