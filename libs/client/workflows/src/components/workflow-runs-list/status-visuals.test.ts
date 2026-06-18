import {type RunStatusDto, runStatusSchema} from '@shipfox/api-workflows-dto';
import {getStatusVisual} from './status-visuals.js';

const EXPECTED_LABELS: Record<RunStatusDto, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

describe('getStatusVisual', () => {
  test.each(runStatusSchema.options)('maps the %s status to its own label', (status) => {
    expect(getStatusVisual(status).label).toBe(EXPECTED_LABELS[status]);
  });

  test('returns the full running visual (dot, badge, and icon)', () => {
    const visual = getStatusVisual('running');

    expect(visual).toEqual({label: 'Running', dot: 'info', badge: 'info', icon: 'spinner'});
  });

  test('falls back to the pending visual for an unknown status', () => {
    const visual = getStatusVisual('archived' as RunStatusDto);

    expect(visual).toEqual(getStatusVisual('pending'));
  });
});
