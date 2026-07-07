import {type AnnotationStyleDto, READ_ANNOTATIONS_MAX_LIMIT} from '@shipfox/annotations-dto';
import {and, asc, eq, inArray, type SQL, sql} from 'drizzle-orm';
import type {Annotation} from '#core/entities/annotation.js';
import {db} from './db.js';
import {annotations, toAnnotation} from './schema/annotations.js';

export const DEFAULT_ANNOTATIONS_READ_LIMIT = READ_ANNOTATIONS_MAX_LIMIT;

export interface ListAnnotationsForRunAttemptParams {
  workflowRunId: string;
  workflowRunAttempt: number;
  workspaceIds: readonly string[];
  jobExecutionId?: string | undefined;
  limit?: number | undefined;
}

export interface ListAnnotationsForRunAttemptResult {
  annotations: Annotation[];
  hasMore: boolean;
}

export async function listAnnotationsForRunAttempt(
  params: ListAnnotationsForRunAttemptParams,
): Promise<ListAnnotationsForRunAttemptResult> {
  if (params.workspaceIds.length === 0) return {annotations: [], hasMore: false};

  const limit = params.limit ?? DEFAULT_ANNOTATIONS_READ_LIMIT;

  const conditions: SQL[] = [
    eq(annotations.workflowRunId, params.workflowRunId),
    eq(annotations.workflowRunAttempt, params.workflowRunAttempt),
    inArray(annotations.workspaceId, [...params.workspaceIds]),
  ];
  if (params.jobExecutionId) {
    conditions.push(eq(annotations.jobExecutionId, params.jobExecutionId));
  }

  const rows = await db()
    .select()
    .from(annotations)
    .where(and(...conditions))
    .orderBy(asc(annotations.sequence), asc(annotations.id))
    .limit(limit + 1);

  return {
    annotations: rows.slice(0, limit).map(toAnnotation),
    hasMore: rows.length > limit,
  };
}

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
  workflowRunAttempt: number;
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
