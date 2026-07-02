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
