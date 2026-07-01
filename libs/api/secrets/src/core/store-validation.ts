import {namespaceSchema, secretKeySchema} from '@shipfox/api-secrets-dto';
import {config, MAX_VALUE_BYTES} from '#config.js';
import {countWorkspaceEntries, type Tx} from '#db/index.js';
import {
  NamespaceValidationError,
  SecretKeyValidationError,
  SecretValueTooLargeError,
  WorkspaceSecretCapExceededError,
} from './errors.js';

export function validateNamespace(namespace: string): void {
  if (namespaceSchema.safeParse(namespace).success) return;
  throw new NamespaceValidationError(namespace);
}

export function validateSecretKeys(keys: Iterable<string>): void {
  for (const key of keys) {
    if (!secretKeySchema.safeParse(key).success) throw new SecretKeyValidationError(key);
  }
}

export function validateValueBytes(values: Iterable<string>): void {
  for (const value of values) {
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
      throw new SecretValueTooLargeError(MAX_VALUE_BYTES);
    }
  }
}

export async function assertWorkspaceCap(params: {
  workspaceId: string;
  incomingEntries: number;
  tx: Tx;
}): Promise<void> {
  const count = await countWorkspaceEntries(params.workspaceId, params.tx);
  if (count + params.incomingEntries > config.SECRETS_MAX_PER_WORKSPACE) {
    throw new WorkspaceSecretCapExceededError(params.workspaceId, config.SECRETS_MAX_PER_WORKSPACE);
  }
}
