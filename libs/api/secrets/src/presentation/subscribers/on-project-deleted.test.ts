import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import {
  db,
  secretsDeletedScopes,
  secretValues,
  secretVariables,
  upsertSecretValueRows,
  upsertSecretVariableRows,
} from '#db/index.js';
import {translateManagementError} from '#presentation/routes/errors.js';
import {onProjectDeleted} from './on-project-deleted.js';

function deletedEvent(params: {workspaceId: string; projectId: string}): ProjectDeletedEvent {
  return {...params, deletedBy: 'user-1', deletedAt: new Date().toISOString()};
}

async function arrange(params: {workspaceId: string; projectId: string | null}) {
  await db().transaction(async (tx) => {
    await upsertSecretValueRows(
      [
        {...params, namespace: '', key: 'TOKEN', ciphertext: 'cipher', fingerprint: null},
        {...params, namespace: '', key: 'OTHER_TOKEN', ciphertext: 'cipher', fingerprint: null},
      ],
      tx,
    );
    await upsertSecretVariableRows([{...params, namespace: '', key: 'REGION', value: 'eu'}], tx);
  });
}

async function countRows(projectId: string) {
  const secrets = await db()
    .select()
    .from(secretValues)
    .where(eq(secretValues.projectId, projectId));
  const variables = await db()
    .select()
    .from(secretVariables)
    .where(eq(secretVariables.projectId, projectId));
  return {secrets: secrets.length, variables: variables.length};
}

describe('onProjectDeleted', () => {
  it('deletes the secrets and variables of the project only', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const otherProjectId = crypto.randomUUID();
    await arrange({workspaceId, projectId});
    await arrange({workspaceId, projectId: otherProjectId});
    await arrange({workspaceId, projectId: null});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    expect(await countRows(projectId)).toEqual({secrets: 0, variables: 0});
    expect(await countRows(otherProjectId)).toEqual({secrets: 2, variables: 1});
    const workspaceLevel = await db()
      .select()
      .from(secretValues)
      .where(eq(secretValues.workspaceId, workspaceId));
    expect(workspaceLevel.filter((row) => row.projectId === null)).toHaveLength(2);
  });

  it('records the marker and sets purged_at once nothing remains', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await arrange({workspaceId, projectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    const [marker] = await db()
      .select()
      .from(secretsDeletedScopes)
      .where(eq(secretsDeletedScopes.projectId, projectId));
    expect(marker).toMatchObject({workspaceId, reason: 'project_deleted'});
    expect(marker?.purgedAt).toBeInstanceOf(Date);
  });

  it('is safe to repeat', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await arrange({workspaceId, projectId});
    const event = deletedEvent({workspaceId, projectId});

    await onProjectDeleted(event);
    await onProjectDeleted(event);

    const markers = await db()
      .select()
      .from(secretsDeletedScopes)
      .where(eq(secretsDeletedScopes.projectId, projectId));
    expect(markers).toHaveLength(1);
    expect(await countRows(projectId)).toEqual({secrets: 0, variables: 0});
  });

  it('refuses a late write to the deleted project and answers not-found', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    const secretWrite = db().transaction((tx) =>
      upsertSecretValueRows(
        [
          {
            workspaceId,
            projectId,
            namespace: '',
            key: 'TOKEN',
            ciphertext: 'cipher',
            fingerprint: null,
          },
        ],
        tx,
      ),
    );
    const variableWrite = db().transaction((tx) =>
      upsertSecretVariableRows(
        [{workspaceId, projectId, namespace: '', key: 'REGION', value: 'eu'}],
        tx,
      ),
    );

    await expect(secretWrite).rejects.toThrow(ScopeDeletedError);
    await expect(variableWrite).rejects.toThrow(ScopeDeletedError);
    expect(await countRows(projectId)).toEqual({secrets: 0, variables: 0});
    expect(() => translateManagementError(new ScopeDeletedError({workspaceId, projectId}))).toThrow(
      expect.objectContaining({code: 'project-not-found', status: 404}),
    );
  });

  it('keeps accepting workspace-level and other-project writes', async () => {
    const workspaceId = crypto.randomUUID();
    await onProjectDeleted(deletedEvent({workspaceId, projectId: crypto.randomUUID()}));
    const otherProjectId = crypto.randomUUID();

    await arrange({workspaceId, projectId: null});
    await arrange({workspaceId, projectId: otherProjectId});

    expect(await countRows(otherProjectId)).toEqual({secrets: 2, variables: 1});
  });
});
