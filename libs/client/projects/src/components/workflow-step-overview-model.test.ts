import {workflowStepOverviewFixtures} from './workflow-step-overview.fixtures.js';
import {toWorkflowStepOverviewModel} from './workflow-step-overview-model.js';

describe('toWorkflowStepOverviewModel', () => {
  test('falls back to a setup name when the DTO step name is null', () => {
    const model = toWorkflowStepOverviewModel(workflowStepOverviewFixtures.setupFailed);

    expect(model?.stepName).toBe('Set up job');
  });

  test('prefers the typed step error message over the opaque attempt error blob', () => {
    const model = toWorkflowStepOverviewModel(workflowStepOverviewFixtures.failed);

    expect(model?.summary?.details).toBe('Command exited with code 1');
  });

  test('surfaces typed restart reasons on attempts', () => {
    const model = toWorkflowStepOverviewModel(workflowStepOverviewFixtures.failed);

    expect(model?.attempts[0]?.restartReason).toBe('Unit tests failed after the generated fix');
    expect(model?.attempts[2]?.restartReason).toBe('Unit tests failed after the generated fix');
  });

  test('handles pending steps that have no dispatched attempts yet', () => {
    const model = toWorkflowStepOverviewModel(workflowStepOverviewFixtures.pending);

    expect(model?.stepName).toBe('Unnamed step 4');
    expect(model?.attempts).toEqual([]);
    expect(model?.currentAttempt).toBeNull();
    expect(model?.summary).toBeNull();
    expect(model?.outputEntries).toEqual([]);
  });
});
