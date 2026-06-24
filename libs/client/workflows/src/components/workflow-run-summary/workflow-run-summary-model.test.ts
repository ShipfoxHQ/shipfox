import {workflowRunShortId} from '#core/workflow-run.js';
import {workflowRun} from '#test/fixtures/workflow-run.js';
import {toWorkflowRunSummary} from './workflow-run-summary-model.js';

describe('workflowRunShortId', () => {
  test('keeps short ids unchanged', () => {
    const shortId = workflowRunShortId('abc123');

    expect(shortId).toBe('abc123');
  });

  test('truncates long ids to their first eight characters', () => {
    const shortId = workflowRunShortId('66666666-6666-4666-8666-666666666666');

    expect(shortId).toBe('66666666');
  });
});

describe('toWorkflowRunSummary', () => {
  test('maps identity, status, trigger, and timestamps from the run model', () => {
    const model = toWorkflowRunSummary(
      workflowRun({
        id: '66666666-6666-4666-8666-666666666666',
        project_id: '44444444-4444-4444-8444-444444444444',
        definition_id: '55555555-5555-4555-8555-555555555555',
        name: 'deploy-web',
        status: 'running',
        trigger_source: 'manual',
        trigger_event: 'fire',
        created_at: '2026-05-07T01:01:00.000Z',
        updated_at: '2026-05-07T01:02:00.000Z',
      }),
    );

    expect(model).toMatchObject({
      id: '66666666-6666-4666-8666-666666666666',
      shortId: '66666666',
      name: 'deploy-web',
      triggerSource: 'manual',
      triggerLabel: 'manual / fire',
      triggeredAt: '2026-05-07T01:01:00.000Z',
    });
    expect(model.status.label).toBe('Running');
    expect(model.status.badge).toBe('info');
  });

  test('omits the trigger label when the run has no trigger source or event', () => {
    const model = toWorkflowRunSummary(workflowRun({trigger_source: '', trigger_event: ''}));

    expect(model.triggerLabel).toBeUndefined();
  });
});
