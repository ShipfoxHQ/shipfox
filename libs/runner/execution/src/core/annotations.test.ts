import {ANNOTATION_CONTEXT_MAX_LENGTH} from '@shipfox/annotations-dto';
import {annotationOperationFileSchema, resolveAnnotationOperations} from '#core/annotations.js';

describe('annotationOperationFileSchema', () => {
  it('parses a default replace operation without defaulting style', () => {
    const operation = annotationOperationFileSchema.parse({
      context: ' default ',
      body: 'summary',
    });

    expect(operation).toEqual({context: 'default', op: 'replace', body: 'summary'});
  });

  it('rejects replace and append operations without a body', () => {
    expect(() => annotationOperationFileSchema.parse({context: 'deploy'})).toThrow();
    expect(() => annotationOperationFileSchema.parse({context: 'deploy', op: 'append'})).toThrow();
  });

  it('rejects remove operations with a body', () => {
    expect(() =>
      annotationOperationFileSchema.parse({context: 'deploy', op: 'remove', body: 'x'}),
    ).toThrow();
  });

  it('rejects contexts over the DTO code point limit', () => {
    expect(() =>
      annotationOperationFileSchema.parse({
        context: '😀'.repeat(ANNOTATION_CONTEXT_MAX_LENGTH + 1),
        body: 'x',
      }),
    ).toThrow();
  });
});

describe('resolveAnnotationOperations', () => {
  it('turns summary content into a default replace operation', () => {
    const operations = resolveAnnotationOperations({summary: '### Build\nok', operations: []});

    expect(operations).toEqual([
      {context: 'default', style: 'default', op: 'replace', body: '### Build\nok'},
    ]);
  });

  it('resolves replace, append, and remove operations in order', () => {
    const operations = resolveAnnotationOperations({
      operations: [
        {context: 'deploy', op: 'replace', style: 'info', body: 'started\n'},
        {context: 'deploy', op: 'append', body: 'done'},
        {context: 'flaky', op: 'append', style: 'warning', body: 'retry'},
        {context: 'old', op: 'replace', body: 'stale'},
        {context: 'old', op: 'remove'},
      ],
    });

    expect(operations).toEqual([
      {context: 'deploy', style: 'info', op: 'replace', body: 'started\ndone'},
      {context: 'flaky', style: 'warning', op: 'append', body: 'retry'},
      {context: 'old', style: 'default', op: 'remove'},
    ]);
  });

  it('lets append style inherit until explicitly changed', () => {
    const operations = resolveAnnotationOperations({
      operations: [
        {context: 'tests', op: 'replace', style: 'info', body: 'one'},
        {context: 'tests', op: 'append', body: ' two'},
        {context: 'tests', op: 'append', style: 'success', body: ' three'},
      ],
    });

    expect(operations).toEqual([
      {context: 'tests', style: 'success', op: 'replace', body: 'one two three'},
    ]);
  });

  it('treats append after remove as a fresh in-step replace', () => {
    const operations = resolveAnnotationOperations({
      operations: [
        {context: 'deploy', op: 'replace', body: 'old'},
        {context: 'deploy', op: 'remove'},
        {context: 'deploy', op: 'append', body: 'new'},
      ],
    });

    expect(operations).toEqual([{context: 'deploy', style: 'default', op: 'replace', body: 'new'}]);
  });

  it('preserves first-seen context order', () => {
    const operations = resolveAnnotationOperations({
      summary: 'summary',
      operations: [
        {context: 'zeta', op: 'replace', body: 'z'},
        {context: 'default', op: 'append', body: ' plus'},
        {context: 'alpha', op: 'replace', body: 'a'},
      ],
    });

    expect(operations.map((operation) => operation.context)).toEqual(['default', 'zeta', 'alpha']);
    expect(operations[0]).toEqual({
      context: 'default',
      style: 'default',
      op: 'replace',
      body: 'summary plus',
    });
  });

  it('returns an empty list for an empty spool', () => {
    const operations = resolveAnnotationOperations({operations: []});

    expect(operations).toEqual([]);
  });
});
