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
  type StoreScope,
  secretsOutbox,
  type Tx,
  upsertSecretValueRows,
  upsertSecretVariableRows,
} from '#db/index.js';
import type {SecretValue} from '#db/schema/values.js';
import type {SecretVariable} from '#db/schema/variables.js';
import {normalizedProjectId} from '#db/scope.js';
import type {DekManager} from './dek-manager.js';
import {SecretNotFoundError, VariableNotFoundError} from './errors.js';
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
    listSecrets: listSecretManagementRows,
    listVariables: listVariableManagementRows,
    async getVariable(
      input: StoreScope & {workspaceId: string; key: string},
    ): Promise<SecretVariable> {
      validateSecretKeys([input.key]);

      const variable = await getVariableManagementRow(input);
      if (!variable) throw new VariableNotFoundError(input.key);
      return variable;
    },
    async setSecrets(input: ManagementWriteParams): Promise<SecretValue[]> {
      const entries = normalizeEntries(input.entries);
      validateSecretKeys(entries.map((entry) => entry.key));
      validateValueBytes(entries.map((entry) => entry.value));

      const projectId = normalizedProjectId(input);
      const dek = await params.dekManager.getPlaintextDek(input.workspaceId);
      return writeManagementEntries({
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
    },
    setVariables(input: ManagementWriteParams): Promise<SecretVariable[]> {
      const entries = normalizeEntries(input.entries);
      validateSecretKeys(entries.map((entry) => entry.key));
      validateValueBytes(entries.map((entry) => entry.value));

      const projectId = normalizedProjectId(input);
      return writeManagementEntries({
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
    },
    async deleteSecret(input: ManagementKeyParams): Promise<void> {
      validateSecretKeys([input.key]);

      const deleted = await deleteManagementEntries({
        input,
        keys: [input.key],
        deleteRows: deleteSecretManagementRows,
        eventType: SECRET_DELETED,
      });
      if (deleted === 0) throw new SecretNotFoundError(input.key);
    },
    async deleteVariable(input: ManagementKeyParams): Promise<void> {
      validateSecretKeys([input.key]);

      const deleted = await deleteManagementEntries({
        input,
        keys: [input.key],
        deleteRows: deleteVariableManagementRows,
        eventType: VARIABLE_DELETED,
      });
      if (deleted === 0) throw new VariableNotFoundError(input.key);
    },
  };
}

function writeManagementEntries<Row extends {key: string}>(params: {
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
  return db().transaction(async (tx) => {
    await lockWorkspaceEntries(params.input.workspaceId, tx);
    const existingKeys = await params.listExistingKeys(
      {
        workspaceId: params.input.workspaceId,
        projectId: normalizedProjectId(params.input),
        keys: params.keys,
      },
      tx,
    );
    await assertWorkspaceCap({
      workspaceId: params.input.workspaceId,
      incomingEntries: params.keys.length - existingKeys.size,
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
}

function deleteManagementEntries<Row extends {key: string}>(params: {
  input: ManagementKeyParams;
  keys: string[];
  deleteRows: (
    params: StoreScope & {workspaceId: string; keys: string[]},
    tx: Tx,
  ) => Promise<Row[]>;
  eventType: typeof SECRET_DELETED | typeof VARIABLE_DELETED;
}): Promise<number> {
  return db().transaction(async (tx) => {
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
}

function normalizeEntries(entries: ManagementEntry[]): ManagementEntry[] {
  const valuesByKey = new Map<string, string>();
  for (const entry of entries) valuesByKey.set(entry.key, entry.value);
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
