import {logObjectKey} from './log-object.js';

describe('logObjectKey', () => {
  it('builds the logs/{workspace}/{job}/{step}/{attempt} key', () => {
    const key = logObjectKey({
      workspaceId: 'ws',
      jobId: 'job',
      stepId: 'step',
      attempt: 2,
    });

    expect(key).toBe('logs/ws/job/step/2');
  });
});
