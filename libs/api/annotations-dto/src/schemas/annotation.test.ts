import {
  ANNOTATION_CONTEXT_MAX_LENGTH,
  leasedWriteAnnotationsBodySchema,
  readAnnotationsResponseSchema,
} from './annotation.js';

describe('annotation schemas', () => {
  it('defaults leased write operation style and op', () => {
    const body = leasedWriteAnnotationsBodySchema.parse({
      step_id: crypto.randomUUID(),
      attempt: 1,
      annotations: [{context: ' default ', body: '### Summary'}],
    });

    expect(body.annotations[0]).toMatchObject({
      context: 'default',
      style: 'default',
      op: 'replace',
      body: '### Summary',
    });
  });

  it('rejects write operations with invalid body pairing', () => {
    const baseBody = {
      step_id: crypto.randomUUID(),
      attempt: 1,
    };

    const missingReplaceBody = () =>
      leasedWriteAnnotationsBodySchema.parse({
        ...baseBody,
        annotations: [{context: 'deploy', op: 'replace'}],
      });
    const removeWithBody = () =>
      leasedWriteAnnotationsBodySchema.parse({
        ...baseBody,
        annotations: [{context: 'deploy', op: 'remove', body: 'ignored'}],
      });

    expect(missingReplaceBody).toThrow();
    expect(removeWithBody).toThrow();
  });

  it('counts context length by Unicode code point', () => {
    const baseBody = {
      step_id: crypto.randomUUID(),
      attempt: 1,
    };
    const maxLengthContext = '😀'.repeat(ANNOTATION_CONTEXT_MAX_LENGTH);
    const tooLongContext = '😀'.repeat(ANNOTATION_CONTEXT_MAX_LENGTH + 1);

    const body = leasedWriteAnnotationsBodySchema.parse({
      ...baseBody,
      annotations: [{context: maxLengthContext, body: 'ok'}],
    });
    const parseTooLong = () =>
      leasedWriteAnnotationsBodySchema.parse({
        ...baseBody,
        annotations: [{context: tooLongContext, body: 'no'}],
      });

    expect(body.annotations[0]?.context).toBe(maxLengthContext);
    expect(parseTooLong).toThrow();
  });

  it('accepts the read response annotation DTO shape', () => {
    const response = readAnnotationsResponseSchema.parse({
      annotations: [
        {
          id: crypto.randomUUID(),
          job_id: crypto.randomUUID(),
          job_execution_id: crypto.randomUUID(),
          origin_step_id: crypto.randomUUID(),
          origin_step_attempt: 1,
          context: 'deploy',
          style: 'success',
          sequence: 1,
          body: 'Deployed **v42**',
        },
      ],
    });

    expect(response.annotations).toHaveLength(1);
  });
});
