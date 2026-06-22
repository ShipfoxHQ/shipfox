import {jobStatusSchema, type RunStatusDto, runStatusSchema} from '@shipfox/api-workflows-dto';
import {getWorkflowStatusVisual} from './status-visuals.js';

const EXPECTED_LABELS: Record<RunStatusDto, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

describe('getWorkflowStatusVisual', () => {
  test.each(runStatusSchema.options)('maps the run %s status to its own label', (status) => {
    expect(getWorkflowStatusVisual(status).label).toBe(EXPECTED_LABELS[status]);
  });

  test.each(jobStatusSchema.options)('maps the job %s status to its own label', (status) => {
    expect(getWorkflowStatusVisual(status).label).toBe(EXPECTED_LABELS[status]);
  });

  test('returns the shared running visual', () => {
    const visual = getWorkflowStatusVisual('running');

    expect(visual).toEqual({
      kind: 'running',
      label: 'Running',
      dot: 'info',
      badge: 'info',
      icon: 'spinner',
    });
  });
});
