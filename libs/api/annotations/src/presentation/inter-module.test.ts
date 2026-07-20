import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from '#core/errors.js';
import {db} from '#db/db.js';
import {annotations} from '#db/schema/annotations.js';
import {
  createAnnotationsInterModulePresentation,
  toReplaceOrRemoveAnnotationKnownError,
} from './inter-module.js';

function input() {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttempt: 1,
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    originStepId: crypto.randomUUID(),
    originStepAttempt: 1,
    context: 'agent-tool-capability:step',
  };
}

describe('Annotations inter-module presentation', () => {
  test('replaces and removes a warning annotation through PostgreSQL', async () => {
    const presentation = createAnnotationsInterModulePresentation();
    const target = input();
    const handlerContext = {signal: new AbortController().signal};

    await presentation.handlers.replaceOrRemoveAnnotation(
      {
        ...target,
        annotation: {op: 'replace', style: 'warning', body: 'Missing tool'},
      },
      handlerContext,
    );
    const afterReplace = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, target.jobExecutionId));

    await presentation.handlers.replaceOrRemoveAnnotation(
      {
        ...target,
        annotation: {op: 'remove'},
      },
      handlerContext,
    );
    const afterRemove = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, target.jobExecutionId));

    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0]).toMatchObject({
      context: target.context,
      style: 'warning',
      body: 'Missing tool',
    });
    expect(afterRemove).toEqual([]);
  });

  test.each([
    ['annotation-body-too-large', () => new AnnotationBodyTooLargeError(10)],
    ['annotation-count-limit-exceeded', () => new AnnotationCountLimitExceededError(10)],
    ['annotation-total-bytes-limit-exceeded', () => new AnnotationTotalBytesLimitExceededError(10)],
  ] as const)('maps %s to the published contract error', (code, createError) => {
    const result = toReplaceOrRemoveAnnotationKnownError(createError());

    expect(
      isInterModuleKnownError(
        annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
        result,
      ) && result.code,
    ).toBe(code);
  });
});
