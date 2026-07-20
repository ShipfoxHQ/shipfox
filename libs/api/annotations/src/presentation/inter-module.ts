import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from '#core/errors.js';
import {writeAnnotations} from '#core/write-annotations.js';

export function createAnnotationsInterModulePresentation(): InterModulePresentation<
  typeof annotationsInterModuleContract
> {
  return defineInterModulePresentation(annotationsInterModuleContract, {
    replaceOrRemoveAnnotation: async (input) => {
      try {
        const {annotation, context, ...target} = input;
        await writeAnnotations({
          ...target,
          operations: [
            annotation.op === 'remove'
              ? {context, style: 'warning', op: 'remove'}
              : {context, ...annotation},
          ],
        });
        return {};
      } catch (error) {
        throw toReplaceOrRemoveAnnotationKnownError(error);
      }
    },
  });
}

export function toReplaceOrRemoveAnnotationKnownError(error: unknown): unknown {
  const method = annotationsInterModuleContract.methods.replaceOrRemoveAnnotation;
  if (error instanceof AnnotationBodyTooLargeError) {
    return createInterModuleKnownError(method, 'annotation-body-too-large', {
      maxBytes: error.maxBytes,
    });
  }
  if (error instanceof AnnotationCountLimitExceededError) {
    return createInterModuleKnownError(method, 'annotation-count-limit-exceeded', {
      maxAnnotations: error.maxAnnotations,
    });
  }
  if (error instanceof AnnotationTotalBytesLimitExceededError) {
    return createInterModuleKnownError(method, 'annotation-total-bytes-limit-exceeded', {
      maxBytes: error.maxBytes,
    });
  }
  return error;
}
