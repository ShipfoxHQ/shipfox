import {workflowStatusVisual} from './workflow-status-visual.js';

describe('workflowStatusVisual', () => {
  test.each([
    ['pending', 'neutral', 'neutral', 'Pending'],
    ['waiting_for_dependencies', 'neutral', 'neutral', 'Waiting'],
    ['running', 'info', 'info', 'Running'],
    ['succeeded', 'success', 'success', 'Succeeded'],
    ['failed', 'error', 'error', 'Failed'],
    ['cancelled', 'neutral', 'neutral', 'Cancelled'],
    ['awaiting_manual', 'feature', 'warning', 'Awaiting manual'],
    ['new-status', 'warning', 'warning', 'Unknown: new-status'],
  ] as const)('maps %s', (status, badge, dot, label) => {
    const result = workflowStatusVisual(status);

    expect(result).toEqual({badge, dot, label});
  });
});
