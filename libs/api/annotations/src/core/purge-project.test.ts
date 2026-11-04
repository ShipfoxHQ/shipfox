import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {annotations} from '#db/schema/annotations.js';
import {annotationsDeletedScopes} from '#db/schema/deleted-scopes.js';
import {annotationFactory} from '#test/index.js';
import {purgeDeletedProject} from './purge-project.js';
import {type WriteAnnotationsParams, writeAnnotations} from './write-annotations.js';

function writeParams(scope: {workspaceId: string; projectId: string}): WriteAnnotationsParams {
  return {
    ...scope,
    workflowRunId: crypto.randomUUID(),
    workflowRunAttempt: 1,
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    originStepId: crypto.randomUUID(),
    originStepAttempt: 1,
    operations: [{context: 'deploy', style: 'success', op: 'replace', body: 'done'}],
  };
}

async function annotationsOf(projectId: string) {
  return await db().select().from(annotations).where(eq(annotations.projectId, projectId));
}

describe('purgeDeletedProject', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  it('deletes the annotations of the project and marks it purged', async () => {
    await annotationFactory.create({workspaceId, projectId});
    await annotationFactory.create({workspaceId, projectId});

    await purgeDeletedProject({workspaceId, projectId});

    expect(await annotationsOf(projectId)).toEqual([]);
    const [marker] = await db()
      .select()
      .from(annotationsDeletedScopes)
      .where(eq(annotationsDeletedScopes.projectId, projectId));
    expect(marker?.purgedAt).toBeInstanceOf(Date);
  });

  it('leaves the annotations of other projects and workspaces alone', async () => {
    const otherProjectId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    await annotationFactory.create({workspaceId, projectId: otherProjectId});
    await annotationFactory.create({workspaceId: otherWorkspaceId, projectId});

    await purgeDeletedProject({workspaceId, projectId});

    expect(await annotationsOf(otherProjectId)).toHaveLength(1);
    expect(await annotationsOf(projectId)).toHaveLength(1);
  });

  it('refuses an annotation written after the purge', async () => {
    await purgeDeletedProject({workspaceId, projectId});

    const write = writeAnnotations(writeParams({workspaceId, projectId}));

    await expect(write).rejects.toBeInstanceOf(ScopeDeletedError);
    expect(await annotationsOf(projectId)).toEqual([]);
  });

  it('still accepts annotations for other projects of the workspace', async () => {
    await purgeDeletedProject({workspaceId, projectId});
    const otherProjectId = crypto.randomUUID();

    await writeAnnotations(writeParams({workspaceId, projectId: otherProjectId}));

    expect(await annotationsOf(otherProjectId)).toHaveLength(1);
  });

  it('is safe to run twice', async () => {
    await annotationFactory.create({workspaceId, projectId});

    await purgeDeletedProject({workspaceId, projectId});

    await expect(purgeDeletedProject({workspaceId, projectId})).resolves.toBeUndefined();
  });
});
