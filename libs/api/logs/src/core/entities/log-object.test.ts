import {logObjectKey} from './log-object.js';

describe('logObjectKey', () => {
  it('builds the {prefix}/{workspace}/{job}/{step}/{attempt} key', () => {
    const key = logObjectKey('logs', {
      workspaceId: 'ws',
      jobId: 'job',
      stepId: 'step',
      attempt: 2,
    });

    expect(key).toBe('logs/ws/job/step/2');
  });

  it('uses the given prefix so one bucket can host several modules', () => {
    const key = logObjectKey('shipfox-logs', {
      workspaceId: 'ws',
      jobId: 'job',
      stepId: 'step',
      attempt: 2,
    });

    expect(key).toBe('shipfox-logs/ws/job/step/2');
  });
});
