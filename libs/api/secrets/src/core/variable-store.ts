import {
  countSecretVariableRows,
  db,
  deleteSecretVariableRows,
  getSecretVariableRowWithPrecedence,
  listSecretVariableRowsByNamespace,
  lockWorkspaceEntries,
  type StoreScope,
  upsertSecretVariableRows,
} from '#db/index.js';
import {normalizedProjectId} from '#db/scope.js';
import {
  assertWorkspaceCap,
  validateNamespace,
  validateSecretKeys,
  validateValueBytes,
} from './store-validation.js';

export interface SetVariablesParams extends StoreScope {
  workspaceId: string;
  namespace?: string | undefined;
  values: Record<string, string>;
  editedBy?: string | null | undefined;
}

export interface DeleteVariablesParams extends StoreScope {
  workspaceId: string;
  namespace?: string | undefined;
  keys?: string[] | undefined;
}

export async function getVariable(
  input: StoreScope & {workspaceId: string; namespace?: string | undefined; key: string},
): Promise<string | null> {
  const namespace = input.namespace ?? '';
  validateNamespace(namespace);
  validateSecretKeys([input.key]);

  const row = await getSecretVariableRowWithPrecedence({...input, namespace});
  return row?.value ?? null;
}

export async function getVariablesByNamespace(
  input: StoreScope & {workspaceId: string; namespace?: string | undefined},
): Promise<Record<string, string>> {
  const namespace = input.namespace ?? '';
  validateNamespace(namespace);

  const rows = await listSecretVariableRowsByNamespace({...input, namespace});
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function setVariables(input: SetVariablesParams): Promise<void> {
  const namespace = input.namespace ?? '';
  const entries = Object.entries(input.values);
  validateNamespace(namespace);
  validateSecretKeys(entries.map(([key]) => key));
  validateValueBytes(entries.map(([, value]) => value));
  if (entries.length === 0) return;

  const projectId = normalizedProjectId(input);
  await db().transaction(async (tx) => {
    await lockWorkspaceEntries(input.workspaceId, tx);
    const existingEntries = await countSecretVariableRows(
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
    await upsertSecretVariableRows(
      entries.map(([key, value]) => ({
        workspaceId: input.workspaceId,
        projectId,
        namespace,
        key,
        value,
        lastEditedBy: input.editedBy ?? null,
      })),
      tx,
    );
  });
}

export function deleteVariables(input: DeleteVariablesParams): Promise<number> {
  const namespace = input.namespace ?? '';
  validateNamespace(namespace);
  if (input.keys) validateSecretKeys(input.keys);

  return deleteSecretVariableRows({
    workspaceId: input.workspaceId,
    projectId: normalizedProjectId(input),
    namespace,
    keys: input.keys,
  });
}
