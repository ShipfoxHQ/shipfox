export class AnnotationBodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Annotation body exceeds ${maxBytes} bytes`);
    this.name = 'AnnotationBodyTooLargeError';
  }
}

export class AnnotationCountLimitExceededError extends Error {
  constructor(public readonly maxAnnotations: number) {
    super(`Annotation count exceeds ${maxAnnotations}`);
    this.name = 'AnnotationCountLimitExceededError';
  }
}

export class AnnotationTotalBytesLimitExceededError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Annotation total body bytes exceed ${maxBytes}`);
    this.name = 'AnnotationTotalBytesLimitExceededError';
  }
}
