import type {JobStatusDto} from '@shipfox/api-workflows-dto';
import {getJobStatusVisual} from './status-visuals.js';

describe('getJobStatusVisual', () => {
  const cases: Array<[JobStatusDto, string, JobStatusDto, string]> = [
    ['pending', 'Pending', 'pending', 'neutral'],
    ['running', 'Running', 'running', 'info'],
    ['succeeded', 'Succeeded', 'succeeded', 'success'],
    ['failed', 'Failed', 'failed', 'error'],
    ['cancelled', 'Cancelled', 'cancelled', 'neutral'],
  ];

  test.each(cases)('maps "%s"', (status, label, kind, dot) => {
    const result = getJobStatusVisual(status);

    expect(result).toMatchObject({label, kind, dot});
  });
});
