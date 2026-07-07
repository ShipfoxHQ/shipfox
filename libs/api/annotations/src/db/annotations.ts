import type {AnnotationStyleDto} from '@shipfox/annotations-dto';
import {and, eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {annotations} from './schema/annotations.js';

export interface StoredAnnotation {
  id: string;
  context: string;
  style: AnnotationStyleDto;
  body: string;
  bodyBytes: number;
  sequence: number;
}

export interface CreateAnnotationParams {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  context: string;
  style: AnnotationStyleDto;
  body: string;
  bodyBytes: number;
  sequence: number;
}

export interface UpdateAnnotationParams {
  id: string;
  originStepId: string;
  originStepAttempt: number;
  style: AnnotationStyleDto;
  body: string;
  bodyBytes: number;
}

export interface AnnotationWriteRepository {
  loadCurrentAnnotations(jobExecutionId: string): Promise<Map<string, StoredAnnotation>>;
  removeAnnotation(jobExecutionId: string, context: string): Promise<void>;
  createAnnotation(params: CreateAnnotationParams): Promise<StoredAnnotation>;
  updateAnnotation(params: UpdateAnnotationParams): Promise<StoredAnnotation>;
}

export function withAnnotationLock<T>(
  jobExecutionId: string,
  work: (repo: AnnotationWriteRepository) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${jobExecutionId}))`);

    const repo: AnnotationWriteRepository = {
      loadCurrentAnnotations: async (lockedJobExecutionId) => {
        const rows = await tx
          .select({
            id: annotations.id,
            context: annotations.context,
            style: annotations.style,
            body: annotations.body,
            bodyBytes: annotations.bodyBytes,
            sequence: annotations.sequence,
          })
          .from(annotations)
          .where(eq(annotations.jobExecutionId, lockedJobExecutionId));

        return new Map(rows.map((row) => [row.context, row]));
      },
      removeAnnotation: async (lockedJobExecutionId, context) => {
        await tx
          .delete(annotations)
          .where(
            and(
              eq(annotations.jobExecutionId, lockedJobExecutionId),
              eq(annotations.context, context),
            ),
          );
      },
      createAnnotation: async (params) => {
        const [row] = await tx.insert(annotations).values(params).returning({
          id: annotations.id,
          context: annotations.context,
          style: annotations.style,
          body: annotations.body,
          bodyBytes: annotations.bodyBytes,
          sequence: annotations.sequence,
        });

        if (!row) throw new Error('createAnnotation: insert returned no row');
        return row;
      },
      updateAnnotation: async (params) => {
        const [row] = await tx
          .update(annotations)
          .set({
            originStepId: params.originStepId,
            originStepAttempt: params.originStepAttempt,
            style: params.style,
            body: params.body,
            bodyBytes: params.bodyBytes,
            updatedAt: new Date(),
          })
          .where(eq(annotations.id, params.id))
          .returning({
            id: annotations.id,
            context: annotations.context,
            style: annotations.style,
            body: annotations.body,
            bodyBytes: annotations.bodyBytes,
            sequence: annotations.sequence,
          });

        if (!row) throw new Error('updateAnnotation: update returned no row');
        return row;
      },
    };

    return await work(repo);
  });
}
