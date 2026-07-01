import {db, deleteSecretValueRows, type StoreScope, upsertSecretValueRows} from '#db/index.js';
import type {DekManager} from './dek-manager.js';
import {fingerprintSecretValue} from './fingerprint.js';
import type {SecretStoreProvider} from './store-resolver.js';
import {
  assertWorkspaceCap,
  validateNamespace,
  validateSecretKeys,
  validateValueBytes,
} from './store-validation.js';
import {encryptSecretValue} from './value-cipher.js';

export interface SetSecretsParams extends StoreScope {
  workspaceId: string;
  namespace?: string | undefined;
  values: Record<string, string>;
  editedBy?: string | null | undefined;
}

export interface DeleteSecretsParams extends StoreScope {
  workspaceId: string;
  namespace?: string | undefined;
  keys?: string[] | undefined;
}

export function createSecretStoreApi(params: {
  dekManager: DekManager;
  resolveSecretStore: (name?: string | undefined) => SecretStoreProvider;
}) {
  return {
    getSecret(
      input: StoreScope & {
        workspaceId: string;
        namespace?: string | undefined;
        key: string;
        store?: string;
      },
    ) {
      const namespace = input.namespace ?? '';
      validateNamespace(namespace);
      validateSecretKeys([input.key]);
      return params.resolveSecretStore(input.store).getSecret({...input, namespace});
    },
    getSecretsByNamespace(
      input: StoreScope & {workspaceId: string; namespace?: string | undefined; store?: string},
    ) {
      const namespace = input.namespace ?? '';
      validateNamespace(namespace);
      return params.resolveSecretStore(input.store).getSecretsByNamespace({...input, namespace});
    },
    async setSecrets(input: SetSecretsParams): Promise<void> {
      const namespace = input.namespace ?? '';
      const entries = Object.entries(input.values);
      validateNamespace(namespace);
      validateSecretKeys(entries.map(([key]) => key));
      validateValueBytes(entries.map(([, value]) => value));
      if (entries.length === 0) return;

      const dek = await params.dekManager.getPlaintextDek(input.workspaceId);
      const projectId = input.projectId ?? null;
      const rows = entries.map(([key, value]) => ({
        workspaceId: input.workspaceId,
        projectId,
        namespace,
        key,
        ciphertext: encryptSecretValue({
          dek,
          workspaceId: input.workspaceId,
          scope: {projectId},
          namespace,
          key,
          value,
        }),
        fingerprint: fingerprintSecretValue(value),
        lastEditedBy: input.editedBy ?? null,
      }));

      await db().transaction(async (tx) => {
        await assertWorkspaceCap({
          workspaceId: input.workspaceId,
          incomingEntries: entries.length,
          tx,
        });
        await upsertSecretValueRows(rows, tx);
      });
    },
    deleteSecrets(input: DeleteSecretsParams): Promise<number> {
      const namespace = input.namespace ?? '';
      validateNamespace(namespace);
      if (input.keys) validateSecretKeys(input.keys);

      return deleteSecretValueRows({
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        namespace,
        keys: input.keys,
      });
    },
  };
}
