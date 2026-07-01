import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db, secretVariables, upsertSecretVariableRows} from '#db/index.js';
import {SecretBatchScopeMismatchError, WorkspaceSecretCapExceededError} from './errors.js';
import {
  deleteVariables,
  getVariable,
  getVariablesByNamespace,
  setVariables,
} from './variable-store.js';

describe('variable store', () => {
  it('stores plaintext variables and applies scope precedence', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    await setVariables({workspaceId, values: {REGION: 'us-east-1'}});
    await setVariables({workspaceId, projectId, values: {REGION: 'eu-west-1'}});
    const projectValue = await getVariable({workspaceId, projectId, key: 'REGION'});
    const values = await getVariablesByNamespace({workspaceId, projectId});
    const rows = await db().select().from(secretVariables);

    expect(projectValue).toBe('eu-west-1');
    expect(values).toEqual({REGION: 'eu-west-1'});
    expect(rows.map((row) => row.value).sort()).toEqual(['eu-west-1', 'us-east-1']);
  });

  it('normalizes an empty project id to workspace scope', async () => {
    const workspaceId = crypto.randomUUID();

    await setVariables({workspaceId, projectId: '', values: {REGION: 'us-east-1'}});
    const value = await getVariable({workspaceId, key: 'REGION'});
    const rows = await db()
      .select()
      .from(secretVariables)
      .where(eq(secretVariables.workspaceId, workspaceId));

    expect(value).toBe('us-east-1');
    expect(rows[0]?.projectId).toBeNull();
  });

  it('treats an empty delete key list as a no-op', async () => {
    const workspaceId = crypto.randomUUID();
    await setVariables({workspaceId, values: {REGION: 'us-east-1'}});

    const deleted = await deleteVariables({workspaceId, keys: []});
    const value = await getVariable({workspaceId, key: 'REGION'});

    expect(deleted).toBe(0);
    expect(value).toBe('us-east-1');
  });

  it('enforces the workspace cap', async () => {
    const workspaceId = crypto.randomUUID();
    const values = Object.fromEntries(
      Array.from({length: 10_001}, (_, index) => [`KEY_${index}`, 'value']),
    );

    await expect(setVariables({workspaceId, values})).rejects.toThrow(
      WorkspaceSecretCapExceededError,
    );
  });

  it('rejects mixed project scopes in one variable upsert batch', async () => {
    const workspaceId = crypto.randomUUID();

    await expect(
      db().transaction((tx) =>
        upsertSecretVariableRows(
          [
            {
              workspaceId,
              projectId: null,
              namespace: '',
              key: 'REGION',
              value: 'us-east-1',
            },
            {
              workspaceId,
              projectId: crypto.randomUUID(),
              namespace: '',
              key: 'OTHER_REGION',
              value: 'eu-west-1',
            },
          ],
          tx,
        ),
      ),
    ).rejects.toThrow(SecretBatchScopeMismatchError);
  });

  it('keeps the database namespace check in parity with the DTO pattern', async () => {
    const workspaceId = crypto.randomUUID();

    await expect(
      db().insert(secretVariables).values({
        workspaceId,
        projectId: null,
        namespace: 'Bad/Namespace',
        key: 'REGION',
        value: 'us-east-1',
      }),
    ).rejects.toThrow();
  });
});
