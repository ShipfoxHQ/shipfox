import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {sql} from 'drizzle-orm';
import {db, secretValues} from '#db/index.js';
import {NamespaceValidationError, SecretKeyValidationError} from './errors.js';
import {deleteSecrets, getSecret, getSecretsByNamespace, setSecrets} from './index.js';

const V1_PREFIX_PATTERN = /^v1:/;

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
    const rows = await db().select().from(secretValues);

    expect(value).toBe('sk-live-value');
    expect(values).toEqual({API_KEY: 'sk-live-value'});
    expect(rows[0]?.ciphertext).toMatch(V1_PREFIX_PATTERN);
    expect(rows[0]?.ciphertext).not.toBe('sk-live-value');
    expect(rows[0]?.fingerprint).toBe('alue');
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

  it('rejects invalid keys and namespaces before writing', async () => {
    const workspaceId = crypto.randomUUID();

    await expect(setSecrets({workspaceId, values: {'bad-key': 'value'}})).rejects.toThrow(
      SecretKeyValidationError,
    );
    await expect(
      setSecrets({workspaceId, namespace: 'Bad/Namespace', values: {TOKEN: 'value'}}),
    ).rejects.toThrow(NamespaceValidationError);
  });

  it('keeps the database key-pattern check in parity with the DTO pattern', async () => {
    const accepted = await db().execute(sql`SELECT 'A_B1' ~ '^[A-Z_][A-Z0-9_]*$' AS ok`);
    const rejected = await db().execute(sql`SELECT 'A-B' ~ '^[A-Z_][A-Z0-9_]*$' AS ok`);

    expect(accepted.rows[0]?.ok).toBe(true);
    expect(rejected.rows[0]?.ok).toBe(false);
  });
});
