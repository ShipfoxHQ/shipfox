import {Factory} from 'fishery';
import type {Annotation} from '#core/entities/annotation.js';
import {db} from '#db/db.js';
import {annotations, toAnnotation} from '#db/schema/annotations.js';

export const annotationFactory = Factory.define<Annotation>(({onCreate}) => {
  onCreate(async (annotation) => {
    const [row] = await db()
      .insert(annotations)
      .values({
        id: annotation.id,
        workspaceId: annotation.workspaceId,
        projectId: annotation.projectId,
        workflowRunId: annotation.workflowRunId,
        workflowRunAttemptId: annotation.workflowRunAttemptId,
        jobId: annotation.jobId,
        jobExecutionId: annotation.jobExecutionId,
        originStepId: annotation.originStepId,
        originStepAttempt: annotation.originStepAttempt,
        context: annotation.context,
        style: annotation.style,
        body: annotation.body,
        bodyBytes: annotation.bodyBytes,
        sequence: annotation.sequence,
        createdAt: annotation.createdAt,
        updatedAt: annotation.updatedAt,
      })
      .returning();

    if (!row) throw new Error('annotationFactory: insert returned no row');
    return toAnnotation(row);
  });

  const body = '### Summary\nAnnotation body';
  const now = new Date();

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    originStepId: crypto.randomUUID(),
    originStepAttempt: 1,
    context: 'default',
    style: 'default',
    body,
    bodyBytes: Buffer.byteLength(body),
    sequence: 1,
    createdAt: now,
    updatedAt: now,
  };
});
