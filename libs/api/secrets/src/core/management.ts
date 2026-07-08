import {
  SECRET_CREATED,
  SECRET_DELETED,
  SECRET_UPDATED,
  type SecretsEventMap,
  VARIABLE_CREATED,
  VARIABLE_DELETED,
  VARIABLE_UPDATED,
} from '@shipfox/api-secrets-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {
  db,
  deleteSecretManagementRows,
  deleteVariableManagementRows,
  getSecretManagementRow,
  getVariableManagementRow,
  listExistingSecretManagementKeys,
  listExistingVariableManagementKeys,
  listSecretManagementRows,
  listVariableManagementRows,
  lockWorkspaceEntries,
  type SecretManagementRow,
  type StoreScope,
  secretsOutbox,
  type Tx,
  upsertSecretValueRows,
  upsertSecretVariableRows,
} from '#db/index.js';
import type {SecretVariable} from '#db/schema/variables.js';
import {normalizedProjectId} from '#db/scope.js';
import {
  classifySecretsOperationError,
  operationScope,
  recordSecretsEntriesMutated,
  recordSecretsOperation,
  type SecretsMetricResource,
} from '#metrics/instance.js';
import type {DekManager} from './dek-manager.js';
import {
  SecretBatchDuplicateKeyError,
  SecretNotFoundError,
  VariableNotFoundError,
} from './errors.js';
import {fingerprintSecretValue} from './fingerprint.js';
import {assertWorkspaceCap, validateSecretKeys, validateValueBytes} from './store-validation.js';
import {encryptSecretValue} from './value-cipher.js';

export interface ManagementEntry {
  key: string;
  value: string;
}

export interface ManagementWriteParams extends StoreScope {
  workspaceId: string;
  entries: ManagementEntry[];
  actorId: string;
}

export interface ManagementKeyParams extends StoreScope {
  workspaceId: string;
  key: string;
  actorId: string;
}

export interface ManagementListParams extends StoreScope {
  workspaceId: string;
  limit: number;
  cursor?: string | undefined;
}

export function createSecretsManagementApi(params: {dekManager: DekManager}) {
  return {
    async listSecrets(input: ManagementListParams) {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const result = await listSecretManagementRows(input);
        recordSecretsOperation({
          resource: 'secret',
          operation: 'list',
          surface: 'management',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        recordSecretsOperation({
          resource: 'secret',
          operation: 'list',
          surface: 'management',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async listVariables(input: ManagementListParams) {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const result = await listVariableManagementRows(input);
        recordSecretsOperation({
          resource: 'variable',
          operation: 'list',
          surface: 'management',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        recordSecretsOperation({
          resource: 'variable',
          operation: 'list',
          surface: 'management',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async getVariable(
      input: StoreScope & {workspaceId: string; key: string},
    ): Promise<SecretVariable> {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        validateSecretKeys([input.key]);

        const variable = await getVariableManagementRow(input);
        if (!variable) throw new VariableNotFoundError(input.key);
        recordSecretsOperation({
          resource: 'variable',
          operation: 'get',
          surface: 'management',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return variable;
      } catch (error) {
        recordSecretsOperation({
          resource: 'variable',
          operation: 'get',
          surface: 'management',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async setSecrets(input: ManagementWriteParams): Promise<SecretManagementRow[]> {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const entries = normalizeEntries(input.entries);
        validateSecretKeys(entries.map((entry) => entry.key));
        validateValueBytes(entries.map((entry) => entry.value));
        if (entries.length === 0) {
          recordSecretsOperation({
            resource: 'secret',
            operation: 'set',
            surface: 'management',
            scope,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
          });
          return [];
        }

        const projectId = normalizedProjectId(input);
        const dek = await params.dekManager.getPlaintextDek(input.workspaceId);
        const rows = await writeManagementEntries({
          resource: 'secret',
          input,
          keys: entries.map((entry) => entry.key),
          listExistingKeys: listExistingSecretManagementKeys,
          writeRows: async (tx) => {
            await upsertSecretValueRows(
              entries.map((entry) => ({
                workspaceId: input.workspaceId,
                projectId,
                namespace: '',
                key: entry.key,
                ciphertext: encryptSecretValue({
                  dek,
                  workspaceId: input.workspaceId,
                  scope: {projectId},
                  namespace: '',
                  key: entry.key,
                  value: entry.value,
                }),
                fingerprint: fingerprintSecretValue(entry.value, dek),
                lastEditedBy: input.actorId,
              })),
              tx,
            );
            const rows = await Promise.all(
              entries.map((entry) =>
                getSecretManagementRow(
                  {workspaceId: input.workspaceId, projectId, key: entry.key},
                  tx,
                ),
              ),
            );
            return rows.map(assertFound);
          },
          eventTypes: {created: SECRET_CREATED, updated: SECRET_UPDATED},
        });
        recordSecretsOperation({
          resource: 'secret',
          operation: 'set',
          surface: 'management',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return rows;
      } catch (error) {
        recordSecretsOperation({
          resource: 'secret',
          operation: 'set',
          surface: 'management',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async setVariables(input: ManagementWriteParams): Promise<SecretVariable[]> {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        const entries = normalizeEntries(input.entries);
        validateSecretKeys(entries.map((entry) => entry.key));
        validateValueBytes(entries.map((entry) => entry.value));
        if (entries.length === 0) {
          recordSecretsOperation({
            resource: 'variable',
            operation: 'set',
            surface: 'management',
            scope,
            outcome: 'success',
            durationMs: Date.now() - startedAt,
          });
          return [];
        }

        const projectId = normalizedProjectId(input);
        const rows = await writeManagementEntries({
          resource: 'variable',
          input,
          keys: entries.map((entry) => entry.key),
          listExistingKeys: listExistingVariableManagementKeys,
          writeRows: async (tx) => {
            await upsertSecretVariableRows(
              entries.map((entry) => ({
                workspaceId: input.workspaceId,
                projectId,
                namespace: '',
                key: entry.key,
                value: entry.value,
                lastEditedBy: input.actorId,
              })),
              tx,
            );
            const rows = await Promise.all(
              entries.map((entry) =>
                getVariableManagementRow(
                  {workspaceId: input.workspaceId, projectId, key: entry.key},
                  tx,
                ),
              ),
            );
            return rows.map(assertFound);
          },
          eventTypes: {created: VARIABLE_CREATED, updated: VARIABLE_UPDATED},
        });
        recordSecretsOperation({
          resource: 'variable',
          operation: 'set',
          surface: 'management',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
        return rows;
      } catch (error) {
        recordSecretsOperation({
          resource: 'variable',
          operation: 'set',
          surface: 'management',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async deleteSecret(input: ManagementKeyParams): Promise<void> {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        validateSecretKeys([input.key]);

        const deleted = await deleteManagementEntries({
          resource: 'secret',
          input,
          keys: [input.key],
          deleteRows: deleteSecretManagementRows,
          eventType: SECRET_DELETED,
        });
        if (deleted === 0) throw new SecretNotFoundError(input.key);
        recordSecretsOperation({
          resource: 'secret',
          operation: 'delete',
          surface: 'management',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        recordSecretsOperation({
          resource: 'secret',
          operation: 'delete',
          surface: 'management',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
    async deleteVariable(input: ManagementKeyParams): Promise<void> {
      const startedAt = Date.now();
      const scope = operationScope(input);
      try {
        validateSecretKeys([input.key]);

        const deleted = await deleteManagementEntries({
          resource: 'variable',
          input,
          keys: [input.key],
          deleteRows: deleteVariableManagementRows,
          eventType: VARIABLE_DELETED,
        });
        if (deleted === 0) throw new VariableNotFoundError(input.key);
        recordSecretsOperation({
          resource: 'variable',
          operation: 'delete',
          surface: 'management',
          scope,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        recordSecretsOperation({
          resource: 'variable',
          operation: 'delete',
          surface: 'management',
          scope,
          outcome: classifySecretsOperationError(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },
  };
}

async function writeManagementEntries<Row extends {key: string}>(params: {
  resource: SecretsMetricResource;
  input: ManagementWriteParams;
  keys: string[];
  listExistingKeys: (
    params: StoreScope & {workspaceId: string; keys: string[]},
    tx: Tx,
  ) => Promise<Set<string>>;
  writeRows: (tx: Tx) => Promise<Row[]>;
  eventTypes: {
    created: typeof SECRET_CREATED | typeof VARIABLE_CREATED;
    updated: typeof SECRET_UPDATED | typeof VARIABLE_UPDATED;
  };
}): Promise<Row[]> {
  let createdCount = 0;
  let updatedCount = 0;
  const rows = await db().transaction(async (tx) => {
    await lockWorkspaceEntries(params.input.workspaceId, tx);
    const existingKeys = await params.listExistingKeys(
      {
        workspaceId: params.input.workspaceId,
        projectId: normalizedProjectId(params.input),
        keys: params.keys,
      },
      tx,
    );
    createdCount = params.keys.length - existingKeys.size;
    updatedCount = existingKeys.size;
    await assertWorkspaceCap({
      workspaceId: params.input.workspaceId,
      namespace: '',
      incomingEntries: createdCount,
      tx,
    });

    const rows = await params.writeRows(tx);
    await Promise.all(
      params.keys.map((key) =>
        writeOutboxEvent<SecretsEventMap>(tx, secretsOutbox, {
          type: existingKeys.has(key) ? params.eventTypes.updated : params.eventTypes.created,
          payload: managementEventPayload(params.input, key),
        }),
      ),
    );
    return rows;
  });
  recordSecretsEntriesMutated({
    resource: params.resource,
    operation: 'set',
    effect: 'created',
    surface: 'management',
    count: createdCount,
  });
  recordSecretsEntriesMutated({
    resource: params.resource,
    operation: 'set',
    effect: 'updated',
    surface: 'management',
    count: updatedCount,
  });
  return rows;
}

async function deleteManagementEntries<Row extends {key: string}>(params: {
  resource: SecretsMetricResource;
  input: ManagementKeyParams;
  keys: string[];
  deleteRows: (
    params: StoreScope & {workspaceId: string; keys: string[]},
    tx: Tx,
  ) => Promise<Row[]>;
  eventType: typeof SECRET_DELETED | typeof VARIABLE_DELETED;
}): Promise<number> {
  const deleted = await db().transaction(async (tx) => {
    await lockWorkspaceEntries(params.input.workspaceId, tx);
    const rows = await params.deleteRows(
      {
        workspaceId: params.input.workspaceId,
        projectId: normalizedProjectId(params.input),
        keys: params.keys,
      },
      tx,
    );
    await Promise.all(
      rows.map((row) =>
        writeOutboxEvent<SecretsEventMap>(tx, secretsOutbox, {
          type: params.eventType,
          payload: managementEventPayload(params.input, row.key),
        }),
      ),
    );
    return rows.length;
  });
  recordSecretsEntriesMutated({
    resource: params.resource,
    operation: 'delete',
    effect: 'deleted',
    surface: 'management',
    count: deleted,
  });
  return deleted;
}

function normalizeEntries(entries: ManagementEntry[]): ManagementEntry[] {
  const valuesByKey = new Map<string, string>();
  for (const entry of entries) {
    if (valuesByKey.has(entry.key)) throw new SecretBatchDuplicateKeyError(entry.key);
    valuesByKey.set(entry.key, entry.value);
  }
  return [...valuesByKey].map(([key, value]) => ({key, value}));
}

function managementEventPayload(
  input: Pick<ManagementWriteParams, 'workspaceId' | 'projectId' | 'actorId'>,
  key: string,
) {
  return {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    projectId: normalizedProjectId(input),
    key,
  };
}

function assertFound<Row>(row: Row | undefined): Row {
  if (!row) throw new Error('Management write returned no row');
  return row;
}
