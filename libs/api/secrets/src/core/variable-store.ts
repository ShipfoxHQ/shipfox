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
  classifySecretsOperationError,
  operationScope,
  recordSecretsEntriesMutated,
  recordSecretsOperation,
} from '#metrics/instance.js';
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
  const startedAt = Date.now();
  const scope = operationScope(input);
  try {
    const namespace = input.namespace ?? '';
    validateNamespace(namespace);
    validateSecretKeys([input.key]);

    const row = await getSecretVariableRowWithPrecedence({...input, namespace});
    recordSecretsOperation({
      resource: 'variable',
      operation: 'get',
      surface: 'internal',
      scope,
      outcome: row ? 'success' : 'not_found',
      durationMs: Date.now() - startedAt,
    });
    return row?.value ?? null;
  } catch (error) {
    recordSecretsOperation({
      resource: 'variable',
      operation: 'get',
      surface: 'internal',
      scope,
      outcome: classifySecretsOperationError(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function getVariablesByNamespace(
  input: StoreScope & {workspaceId: string; namespace?: string | undefined},
): Promise<Record<string, string>> {
  const startedAt = Date.now();
  const scope = operationScope(input);
  try {
    const namespace = input.namespace ?? '';
    validateNamespace(namespace);

    const rows = await listSecretVariableRowsByNamespace({...input, namespace});
    recordSecretsOperation({
      resource: 'variable',
      operation: 'get_namespace',
      surface: 'internal',
      scope,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
    });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } catch (error) {
    recordSecretsOperation({
      resource: 'variable',
      operation: 'get_namespace',
      surface: 'internal',
      scope,
      outcome: classifySecretsOperationError(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function setVariables(input: SetVariablesParams): Promise<void> {
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
        resource: 'variable',
        operation: 'set',
        surface: 'internal',
        scope,
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const projectId = normalizedProjectId(input);
    let existingEntries = 0;
    await db().transaction(async (tx) => {
      await lockWorkspaceEntries(input.workspaceId, tx);
      existingEntries = await countSecretVariableRows(
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

    recordSecretsEntriesMutated({
      resource: 'variable',
      operation: 'set',
      effect: 'created',
      surface: 'internal',
      count: entries.length - existingEntries,
    });
    recordSecretsEntriesMutated({
      resource: 'variable',
      operation: 'set',
      effect: 'updated',
      surface: 'internal',
      count: existingEntries,
    });
    recordSecretsOperation({
      resource: 'variable',
      operation: 'set',
      surface: 'internal',
      scope,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    recordSecretsOperation({
      resource: 'variable',
      operation: 'set',
      surface: 'internal',
      scope,
      outcome: classifySecretsOperationError(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function deleteVariables(input: DeleteVariablesParams): Promise<number> {
  const startedAt = Date.now();
  const scope = operationScope(input);
  try {
    const namespace = input.namespace ?? '';
    validateNamespace(namespace);
    if (input.keys) validateSecretKeys(input.keys);

    const deleted = await deleteSecretVariableRows({
      workspaceId: input.workspaceId,
      projectId: normalizedProjectId(input),
      namespace,
      keys: input.keys,
    });
    recordSecretsEntriesMutated({
      resource: 'variable',
      operation: 'delete',
      effect: 'deleted',
      surface: 'internal',
      count: deleted,
    });
    recordSecretsOperation({
      resource: 'variable',
      operation: 'delete',
      surface: 'internal',
      scope,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
    });
    return deleted;
  } catch (error) {
    recordSecretsOperation({
      resource: 'variable',
      operation: 'delete',
      surface: 'internal',
      scope,
      outcome: classifySecretsOperationError(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
