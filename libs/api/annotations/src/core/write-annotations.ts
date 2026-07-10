import type {LeasedWriteAnnotationOperationDto} from '@shipfox/annotations-dto';
import {config} from '#config.js';
import {type StoredAnnotation, withAnnotationLock} from '#db/annotations.js';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from './errors.js';

export interface WriteAnnotationsParams {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  operations: readonly LeasedWriteAnnotationOperationDto[];
}

export interface WriteAnnotationsResult {
  annotations: Array<{context: string; id: string | null}>;
  accounting: {
    annotationCount: number;
    totalBodyBytes: number;
  };
}

export function writeAnnotations(params: WriteAnnotationsParams): Promise<WriteAnnotationsResult> {
  return withAnnotationLock(params.jobExecutionId, async (repo) => {
    const current = await repo.loadCurrentAnnotations(params.jobExecutionId);
    let nextSequence =
      Math.max(0, ...Array.from(current.values()).map((annotation) => annotation.sequence)) + 1;
    const results: WriteAnnotationsResult['annotations'] = [];

    for (const operation of params.operations) {
      if (operation.op === 'remove') {
        await repo.removeAnnotation(params.jobExecutionId, operation.context);
        current.delete(operation.context);
        results.push({context: operation.context, id: null});
        continue;
      }

      const existing = current.get(operation.context);
      const body =
        operation.op === 'append' ? `${existing?.body ?? ''}${operation.body}` : operation.body;
      const bodyBytes = Buffer.byteLength(body);
      ensureBodyBudget(bodyBytes);

      const isUnchangedReplace =
        operation.op === 'replace' &&
        existing !== undefined &&
        existing.body === body &&
        existing.style === operation.style;
      if (isUnchangedReplace) {
        results.push({context: operation.context, id: existing.id});
        continue;
      }

      const draft = new Map(current);
      draft.set(operation.context, {
        id: existing?.id ?? '',
        context: operation.context,
        style: operation.style,
        body,
        bodyBytes,
        sequence: existing?.sequence ?? nextSequence,
      });
      ensureExecutionBudgets(draft);

      const row = existing
        ? await repo.updateAnnotation({
            id: existing.id,
            originStepId: params.originStepId,
            originStepAttempt: params.originStepAttempt,
            style: operation.style,
            body,
            bodyBytes,
          })
        : await repo.createAnnotation({
            workspaceId: params.workspaceId,
            projectId: params.projectId,
            workflowRunId: params.workflowRunId,
            workflowRunAttempt: params.workflowRunAttempt,
            workflowRunAttemptId: params.workflowRunAttemptId,
            jobId: params.jobId,
            jobExecutionId: params.jobExecutionId,
            originStepId: params.originStepId,
            originStepAttempt: params.originStepAttempt,
            context: operation.context,
            style: operation.style,
            body,
            bodyBytes,
            sequence: nextSequence,
          });

      current.set(operation.context, {
        id: row.id,
        context: row.context,
        style: row.style,
        body: row.body,
        bodyBytes: row.bodyBytes,
        sequence: row.sequence,
      });
      if (!existing) nextSequence += 1;
      results.push({context: operation.context, id: row.id});
    }

    return {
      annotations: results,
      accounting: currentAccounting(current),
    };
  });
}

function ensureBodyBudget(bodyBytes: number): void {
  if (bodyBytes > config.ANNOTATIONS_MAX_BODY_BYTES) {
    throw new AnnotationBodyTooLargeError(config.ANNOTATIONS_MAX_BODY_BYTES);
  }
}

function ensureExecutionBudgets(annotationsByContext: ReadonlyMap<string, StoredAnnotation>): void {
  const accounting = currentAccounting(annotationsByContext);
  if (accounting.annotationCount > config.ANNOTATIONS_MAX_PER_EXECUTION) {
    throw new AnnotationCountLimitExceededError(config.ANNOTATIONS_MAX_PER_EXECUTION);
  }
  if (accounting.totalBodyBytes > config.ANNOTATIONS_MAX_TOTAL_BYTES) {
    throw new AnnotationTotalBytesLimitExceededError(config.ANNOTATIONS_MAX_TOTAL_BYTES);
  }
}

function currentAccounting(annotationsByContext: ReadonlyMap<string, StoredAnnotation>) {
  return {
    annotationCount: annotationsByContext.size,
    totalBodyBytes: Array.from(annotationsByContext.values()).reduce(
      (total, annotation) => total + annotation.bodyBytes,
      0,
    ),
  };
}
