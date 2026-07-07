import {leasedWriteAnnotationsBodySchema, readAnnotationsResponseSchema} from './annotation.js';

describe('annotation schemas', () => {
  it('defaults leased write operation style and op', () => {
    const body = leasedWriteAnnotationsBodySchema.parse({
      step_id: crypto.randomUUID(),
      attempt: 1,
      annotations: [{context: 'default', body: '### Summary'}],
    });

    expect(body.annotations[0]).toMatchObject({
      context: 'default',
      style: 'default',
      op: 'replace',
      body: '### Summary',
    });
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
