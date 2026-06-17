import {
  failedWorkflowRunSummaryFixture,
  missingTriggerWorkflowRunSummaryFixture,
  runningWorkflowRunSummaryFixture,
  succeededWorkflowRunSummaryFixture,
} from './workflow-run-summary.fixtures.js';
import {toWorkflowRunSummary, type WorkflowRunSummaryRun} from './workflow-run-summary-model.js';

function makeRun(overrides: Partial<WorkflowRunSummaryRun> = {}): WorkflowRunSummaryRun {
  return {
    ...failedWorkflowRunSummaryFixture,
    ...overrides,
  };
}

describe('toWorkflowRunSummary', () => {
  test.each([
    [failedWorkflowRunSummaryFixture, 'Failed', 'error', 'error'],
    [runningWorkflowRunSummaryFixture, 'Running', 'info', 'info'],
    [succeededWorkflowRunSummaryFixture, 'Succeeded', 'success', 'success'],
  ])('maps %s status metadata', (run, statusLabel, statusVariant, dotVariant) => {
    const result = toWorkflowRunSummary(run);

    expect(result.statusLabel).toBe(statusLabel);
    expect(result.statusVariant).toBe(statusVariant);
    expect(result.dotVariant).toBe(dotVariant);
  });

  test('maps run identity and timestamps without duration data', () => {
    const result = toWorkflowRunSummary(runningWorkflowRunSummaryFixture);

    expect(result).toMatchObject({
      id: runningWorkflowRunSummaryFixture.id,
      shortId: '43090000',
      name: 'Checkout remediation',
      createdAt: runningWorkflowRunSummaryFixture.created_at,
      updatedAt: runningWorkflowRunSummaryFixture.updated_at,
    });
  });

  test('trims trigger source and event labels', () => {
    const run = makeRun({
      trigger_source: '  github  ',
      trigger_event: '  push  ',
    });

    const result = toWorkflowRunSummary(run);

    expect(result.triggerLabel).toBe('github · push');
    expect(result.triggerIcon).toBe('github');
  });

  test('falls back when trigger metadata is missing', () => {
    const result = toWorkflowRunSummary(missingTriggerWorkflowRunSummaryFixture);

    expect(result.triggerLabel).toBe('unknown trigger');
    expect(result.triggerPayloadLabel).toBe('0 payload fields');
  });

  test.each([
    [{}, '0 payload fields'],
    [{branch: 'main'}, '1 payload field'],
    [{issue: 'SENTRY-CHKOUT-9002', retry: false}, '2 payload fields'],
  ])('summarizes payload shape generically', (triggerPayload, triggerPayloadLabel) => {
    const run = makeRun({trigger_payload: triggerPayload});

    const result = toWorkflowRunSummary(run);

    expect(result.triggerPayloadLabel).toBe(triggerPayloadLabel);
  });
});
