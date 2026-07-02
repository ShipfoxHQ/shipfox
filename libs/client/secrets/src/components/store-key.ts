import {secretKeySchema} from '@shipfox/api-secrets-dto';

export const STORE_KEY_HELP =
  'Uppercase letters, digits and underscores; must start with a letter or underscore.';

/**
 * Validates a store key against the shared `secretKeySchema` and returns a
 * human-readable message (not Zod's default) when it fails. The name input is
 * also auto-uppercased at the call site, so the common case never trips this.
 */
export function validateStoreKey(value: string): string | undefined {
  return secretKeySchema.safeParse(value).success ? undefined : STORE_KEY_HELP;
}

/**
 * Format validation plus a create-mode collision guard. `PUT /:key` is an
 * upsert and single writes never return a duplicate-key error, so without this
 * a create with an existing name would silently overwrite the current value —
 * unrecoverable for write-only secrets. Edit mode locks the key, so it skips
 * the collision check.
 */
export function validateNewStoreKey(
  value: string,
  {
    mode,
    reservedKeys,
    kind,
  }: {mode: 'create' | 'edit'; reservedKeys: readonly string[]; kind: 'secret' | 'variable'},
): string | undefined {
  const formatError = validateStoreKey(value);
  if (formatError) return formatError;
  if (mode === 'create' && reservedKeys.includes(value)) {
    return `A ${kind} with this name already exists. Edit it instead.`;
  }
  return undefined;
}
