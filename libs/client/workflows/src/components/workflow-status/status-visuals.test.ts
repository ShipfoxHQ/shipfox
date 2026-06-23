import {jobStatusSchema, type RunStatusDto, runStatusSchema} from '@shipfox/api-workflows-dto';
import type {IconName} from '@shipfox/react-ui';
import {getWorkflowStatusVisual} from './status-visuals.js';

const EXPECTED_LABELS: Record<RunStatusDto, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// The glyph WorkflowStatusIcon renders per state. `running` is a fallback (the component
// draws the live Dot instead), but every state still maps to a concrete circular glyph so
// the shape channel is locked, not just the label.
const EXPECTED_ICONS: Record<RunStatusDto, IconName> = {
  pending: 'circleDottedLine',
  running: 'circleFill',
  succeeded: 'checkCircleSolid',
  failed: 'xCircleSolid',
  cancelled: 'forbid2Fill',
};

describe('getWorkflowStatusVisual', () => {
  test.each(runStatusSchema.options)('maps the run %s status to its own label', (status) => {
    expect(getWorkflowStatusVisual(status).label).toBe(EXPECTED_LABELS[status]);
  });

  test.each(jobStatusSchema.options)('maps the job %s status to its own label', (status) => {
    expect(getWorkflowStatusVisual(status).label).toBe(EXPECTED_LABELS[status]);
  });

  test.each(runStatusSchema.options)('maps the %s status to its own glyph', (status) => {
    expect(getWorkflowStatusVisual(status).icon).toBe(EXPECTED_ICONS[status]);
  });

  test('returns the shared running visual', () => {
    const visual = getWorkflowStatusVisual('running');

    expect(visual).toEqual({
      kind: 'running',
      label: 'Running',
      dot: 'info',
      badge: 'info',
      icon: 'circleFill',
    });
  });
});
