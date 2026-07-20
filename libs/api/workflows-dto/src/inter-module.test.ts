import {workflowsInterModuleContract} from './inter-module.js';

describe('workflowsInterModuleContract', () => {
  test('accepts trigger commands and listener deliveries', () => {
    const start = workflowsInterModuleContract.methods.startRunFromTrigger.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      definitionId: '00000000-0000-4000-8000-000000000003',
      triggerPayload: {
        provider: 'github',
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      idempotencyKey: 'subscription-1:event-1',
    });
    const delivery = workflowsInterModuleContract.methods.deliverEventToJobListener.input.parse({
      jobId: '00000000-0000-4000-8000-000000000004',
      disposition: 'fire',
      eventRef: 'event-1',
      deliveryId: 'delivery-1',
      source: 'github',
      event: 'push',
      provider: 'github',
      payload: {ref: 'refs/heads/main'},
      receivedAt: '2026-07-20T12:00:00.000Z',
    });

    expect(start.idempotencyKey).toBe('subscription-1:event-1');
    expect(delivery.disposition).toBe('fire');
  });

  test.each([
    ['definition-not-found', {definitionId: '00000000-0000-4000-8000-000000000001'}],
    ['project-mismatch', {}],
    ['agent-config-unresolvable', {definitionId: '00000000-0000-4000-8000-000000000001'}],
    ['agent-integration-materialization-failed', {}],
    [
      'interpolation-unresolvable',
      {
        definitionId: '00000000-0000-4000-8000-000000000001',
        field: 'env',
        source: 'event.ref',
        envKey: 'REF',
      },
    ],
    ['invalid-job-runner-labels', {labels: ['linux', 'gpu']}],
  ] as const)('defines the %s start-run failure', (code, details) => {
    const schema = workflowsInterModuleContract.methods.startRunFromTrigger.errors[code];
    const parsed = schema.parse(details);

    expect(parsed).toEqual(details);
  });
});
