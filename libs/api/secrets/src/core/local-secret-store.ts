import {
  getSecretValueRowWithPrecedence,
  listSecretValueRowsByNamespace,
  type StoreScope,
} from '#db/index.js';
import type {DekManager} from './dek-manager.js';
import {decryptSecretValue} from './value-cipher.js';

export interface LocalSecretStoreParams {
  dekManager: DekManager;
}

export function createLocalSecretStore(params: LocalSecretStoreParams) {
  return {
    async getSecret(input: StoreScope & {workspaceId: string; namespace: string; key: string}) {
      const row = await getSecretValueRowWithPrecedence(input);
      if (!row) return null;

      const dek = await params.dekManager.getPlaintextDek(input.workspaceId);
      return decryptSecretValue({
        dek,
        workspaceId: row.workspaceId,
        scope: {projectId: row.projectId},
        namespace: row.namespace,
        key: row.key,
        ciphertext: row.ciphertext,
      });
    },
    async getSecretsByNamespace(input: StoreScope & {workspaceId: string; namespace: string}) {
      const rows = await listSecretValueRowsByNamespace(input);
      const dek =
        rows.length > 0 ? await params.dekManager.getPlaintextDek(input.workspaceId) : null;

      return Object.fromEntries(
        rows.map((row) => [
          row.key,
          decryptSecretValue({
            dek: dek as Buffer,
            workspaceId: row.workspaceId,
            scope: {projectId: row.projectId},
            namespace: row.namespace,
            key: row.key,
            ciphertext: row.ciphertext,
          }),
        ]),
      );
    },
  };
}
