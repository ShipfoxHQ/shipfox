import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {eq, sql} from 'drizzle-orm';
import {db, secretDataKeys, secretValues, upsertSecretValueRows} from '#db/index.js';
import {
  NamespaceValidationError,
  SecretBatchScopeMismatchError,
  SecretDecryptionError,
  SecretKeyValidationError,
  SecretValueTooLargeError,
  WorkspaceSecretCapExceededError,
} from './errors.js';
import {dekManager, deleteSecrets, getSecret, getSecretsByNamespace, setSecrets} from './index.js';

const V1_PREFIX_PATTERN = /^v1:/;
const HMAC_FINGERPRINT_PATTERN = /^hmac-sha256:[A-Za-z0-9_-]{43}$/;

describe('secret store', () => {
  it('sets, encrypts, and reads secrets by namespace', async () => {
    const workspaceId = crypto.randomUUID();

    await setSecrets({
      workspaceId,
      namespace: 'system/agent/openai',
      values: {API_KEY: 'sk-live-value'},
    });

    const value = await getSecret({
      workspaceId,
      namespace: 'system/agent/openai',
      key: 'API_KEY',
    });
    const values = await getSecretsByNamespace({workspaceId, namespace: 'system/agent/openai'});
    const rows = await db()
      .select()
      .from(secretValues)
      .where(eq(secretValues.workspaceId, workspaceId));

    expect(value).toBe('sk-live-value');
    expect(values).toEqual({API_KEY: 'sk-live-value'});
    expect(rows[0]?.ciphertext).toMatch(V1_PREFIX_PATTERN);
    expect(rows[0]?.ciphertext).not.toBe('sk-live-value');
    expect(rows[0]?.fingerprint).toMatch(HMAC_FINGERPRINT_PATTERN);
    expect(rows[0]?.fingerprint).not.toContain('alue');
  });

  it('prefers project scope over workspace scope and deletes only exact project scope', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    await setSecrets({workspaceId, values: {TOKEN: 'workspace-token'}});
    await setSecrets({workspaceId, projectId, values: {TOKEN: 'project-token'}});
    const projectValue = await getSecret({workspaceId, projectId, key: 'TOKEN'});
    const workspaceValue = await getSecret({workspaceId, key: 'TOKEN'});
    await deleteSecrets({workspaceId, projectId});
    const inheritedValue = await getSecret({workspaceId, projectId, key: 'TOKEN'});

    expect(projectValue).toBe('project-token');
    expect(workspaceValue).toBe('workspace-token');
    expect(inheritedValue).toBe('workspace-token');
  });

  it('normalizes an empty project id to workspace scope', async () => {
    const workspaceId = crypto.randomUUID();

    await setSecrets({workspaceId, projectId: '', values: {TOKEN: 'workspace-token'}});
    const value = await getSecret({workspaceId, key: 'TOKEN'});
    const rows = await db()
      .select()
      .from(secretValues)
      .where(eq(secretValues.workspaceId, workspaceId));

    expect(value).toBe('workspace-token');
    expect(rows[0]?.projectId).toBeNull();
  });

  it('treats an empty delete key list as a no-op', async () => {
    const workspaceId = crypto.randomUUID();
    await setSecrets({workspaceId, values: {TOKEN: 'keep-me'}});

    const deleted = await deleteSecrets({workspaceId, keys: []});
    const value = await getSecret({workspaceId, key: 'TOKEN'});

    expect(deleted).toBe(0);
    expect(value).toBe('keep-me');
  });

  it('rejects invalid keys and namespaces before writing', async () => {
    const workspaceId = crypto.randomUUID();

    await expect(setSecrets({workspaceId, values: {'bad-key': 'value'}})).rejects.toThrow(
      SecretKeyValidationError,
    );
    await expect(
      setSecrets({workspaceId, namespace: 'Bad/Namespace', values: {TOKEN: 'value'}}),
    ).rejects.toThrow(NamespaceValidationError);
  });

  it('rejects oversized values with a typed domain error', async () => {
    const workspaceId = crypto.randomUUID();

    await expect(
      setSecrets({workspaceId, values: {TOKEN: 'a'.repeat(64 * 1024 + 1)}}),
    ).rejects.toThrow(SecretValueTooLargeError);
  });

  it('enforces the workspace cap', async () => {
    const workspaceId = crypto.randomUUID();
    const values = Object.fromEntries(
      Array.from({length: 10_001}, (_, index) => [`KEY_${index}`, 'value']),
    );

    await expect(setSecrets({workspaceId, values})).rejects.toThrow(
      WorkspaceSecretCapExceededError,
    );
  });

  it('allows updating an existing secret at the workspace cap', async () => {
    const workspaceId = crypto.randomUUID();
    await setSecrets({workspaceId, values: {TOKEN: 'old-value'}});
    await db()
      .insert(secretValues)
      .values(
        Array.from({length: 9_999}, (_, index) => ({
          workspaceId,
          projectId: null,
          namespace: '',
          key: `KEY_${index}`,
          ciphertext: 'v1:test',
          fingerprint: null,
        })),
      );

    await setSecrets({workspaceId, values: {TOKEN: 'new-value'}});
    const value = await getSecret({workspaceId, key: 'TOKEN'});

    expect(value).toBe('new-value');
  });

  it('does not mint a data key for an empty batch', async () => {
    const workspaceId = crypto.randomUUID();

    await setSecrets({workspaceId, values: {}});
    const rows = await db()
      .select()
      .from(secretDataKeys)
      .where(eq(secretDataKeys.workspaceId, workspaceId));

    expect(rows).toHaveLength(0);
  });

  it('rolls back value rows when the write transaction fails', async () => {
    const workspaceId = crypto.randomUUID();

    await expect(
      db().transaction(async (tx) => {
        await upsertSecretValueRows(
          [
            {
              workspaceId,
              projectId: null,
              namespace: '',
              key: 'TOKEN',
              ciphertext: 'v1:test',
              fingerprint: null,
            },
          ],
          tx,
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const rows = await db()
      .select()
      .from(secretValues)
      .where(eq(secretValues.workspaceId, workspaceId));

    expect(rows).toHaveLength(0);
  });

  it('rejects mixed project scopes in one value upsert batch', async () => {
    const workspaceId = crypto.randomUUID();

    await expect(
      db().transaction((tx) =>
        upsertSecretValueRows(
          [
            {
              workspaceId,
              projectId: null,
              namespace: '',
              key: 'TOKEN',
              ciphertext: 'v1:test',
              fingerprint: null,
            },
            {
              workspaceId,
              projectId: crypto.randomUUID(),
              namespace: '',
              key: 'OTHER_TOKEN',
              ciphertext: 'v1:test',
              fingerprint: null,
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
      db().insert(secretValues).values({
        workspaceId,
        projectId: null,
        namespace: 'Bad/Namespace',
        key: 'TOKEN',
        ciphertext: 'v1:test',
        fingerprint: null,
      }),
    ).rejects.toThrow();
  });

  it('fails closed when the workspace data key is removed', async () => {
    const workspaceId = crypto.randomUUID();
    await setSecrets({workspaceId, values: {TOKEN: 'recover-me'}});
    dekManager().invalidate(workspaceId);
    await db().delete(secretDataKeys).where(eq(secretDataKeys.workspaceId, workspaceId));

    await expect(getSecret({workspaceId, key: 'TOKEN'})).rejects.toThrow(SecretDecryptionError);
  });

  it('keeps the database key-pattern check in parity with the DTO pattern', async () => {
    const accepted = await db().execute(sql`
      SELECT bool_and(value ~ '^[A-Z_][A-Z0-9_]*$') AS ok
      FROM (VALUES ('A_B1'), ('_A')) accepted(value)
    `);
    const rejected = await db().execute(sql`
      SELECT bool_or(value ~ '^[A-Z_][A-Z0-9_]*$') AS ok
      FROM (VALUES ('A-B'), ('1A'), ('a')) rejected(value)
    `);

    expect(accepted.rows[0]?.ok).toBe(true);
    expect(rejected.rows[0]?.ok).toBe(false);
  });
});
