import {
  countSecretValueRows,
  db,
  deleteSecretValueRows,
  lockWorkspaceEntries,
  type StoreScope,
  upsertSecretValueRows,
} from '#db/index.js';
import {normalizedProjectId} from '#db/scope.js';
import {
  classifySecretsOperationError,
  operationScope,
  recordSecretsEntriesMutated,
  recordSecretsOperation,
} from '#metrics/instance.js';
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
    async getSecret(
      input: StoreScope & {
        workspaceId: string;
        namespace?: string | undefined;
        key: string;
        store?: string;
      },
    ) {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const namespace = input.namespace ?? '';
        validateNamespace(namespace);
        validateSecretKeys([input.key]);
        const value = await params.resolveSecretStore(input.store).getSecret({...input, namespace});
        recordSecretsOperation({
          resource: 'secret',
          operation: 'get',
          surface: 'internal',
          scope,
          outcome: value === null ? 'not_found' : 'success',
          durationMs: Date.now() - startedAt,
        });
        return value;
      } catch (error) {
        recordSecretsOperation({
          resource: 'secret',
          operation: 'get',
          surface: 'internal',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async getSecretsByNamespace(
      input: StoreScope & {workspaceId: string; namespace?: string | undefined; store?: string},
    ) {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const namespace = input.namespace ?? '';
        validateNamespace(namespace);
        const values = await params
          .resolveSecretStore(input.store)
          .getSecretsByNamespace({...input, namespace});
        recordSecretsOperation({
          resource: 'secret',
          operation: 'get_namespace',
          surface: 'internal',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return values;
      } catch (error) {
        recordSecretsOperation({
          resource: 'secret',
          operation: 'get_namespace',
          surface: 'internal',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async setSecrets(input: SetSecretsParams): Promise<void> {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const namespace = input.namespace ?? '';
        const entries = Object.entries(input.values);
        validateNamespace(namespace);
        validateSecretKeys(entries.map(([key]) => key));
        validateValueBytes(entries.map(([, value]) => value));
        if (entries.length === 0) {
          recordSecretsOperation({
            resource: 'secret',
            operation: 'set',
            surface: 'internal',
            scope,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
          });
          return;
        }

        const dek = await params.dekManager.getPlaintextDek(input.workspaceId);
        const projectId = normalizedProjectId(input);
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
          fingerprint: fingerprintSecretValue(value, dek),
          lastEditedBy: input.editedBy ?? null,
        }));

        let existingEntries = 0;
        await db().transaction(async (tx) => {
          await lockWorkspaceEntries(input.workspaceId, tx);
          existingEntries = await countSecretValueRows(
            {
              workspaceId: input.workspaceId,
              projectId,
              namespace,
              keys: entries.map(([key]) => key),
            },
            tx,
          );
          await assertWorkspaceCap({
            workspaceId: input.workspaceId,
            namespace,
            incomingEntries: entries.length - existingEntries,
            tx,
          });
          await upsertSecretValueRows(rows, tx);
        });

        recordSecretsEntriesMutated({
          resource: 'secret',
          operation: 'set',
          effect: 'created',
          surface: 'internal',
          count: entries.length - existingEntries,
        });
        recordSecretsEntriesMutated({
          resource: 'secret',
          operation: 'set',
          effect: 'updated',
          surface: 'internal',
          count: existingEntries,
        });
        recordSecretsOperation({
          resource: 'secret',
          operation: 'set',
          surface: 'internal',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        recordSecretsOperation({
          resource: 'secret',
          operation: 'set',
          surface: 'internal',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async deleteSecrets(input: DeleteSecretsParams): Promise<number> {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const namespace = input.namespace ?? '';
        validateNamespace(namespace);
        if (input.keys) validateSecretKeys(input.keys);

        const deleted = await deleteSecretValueRows({
          workspaceId: input.workspaceId,
          projectId: normalizedProjectId(input),
          namespace,
          keys: input.keys,
        });
        recordSecretsEntriesMutated({
          resource: 'secret',
          operation: 'delete',
          effect: 'deleted',
          surface: 'internal',
          count: deleted,
        });
        recordSecretsOperation({
          resource: 'secret',
          operation: 'delete',
          surface: 'internal',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return deleted;
      } catch (error) {
        recordSecretsOperation({
          resource: 'secret',
          operation: 'delete',
          surface: 'internal',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
  };
}
