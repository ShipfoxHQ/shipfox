import type {TriggerSubscription} from './entities/subscription.js';

// Narrow the jsonb projection at the read boundary: the parser writes the right shapes,
// but the column is unconstrained and these values reach run inputs.

export function readConfigInputs(
  subscription: TriggerSubscription,
): Record<string, unknown> | undefined {
  const value = subscription.config.with;
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
