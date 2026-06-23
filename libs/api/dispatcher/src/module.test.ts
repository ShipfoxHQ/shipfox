import {DISPATCHER_WORKFLOW_ID, OUTBOX_RETENTION_WORKFLOW_ID} from '#core/constants.js';
import {dispatcherModule} from './module.js';

describe('dispatcherModule', () => {
  it('registers dispatch and retention workflows on the dispatcher worker', () => {
    const worker = dispatcherModule.workers?.[0];

    expect(worker?.workflows).toEqual([
      {name: 'outboxDispatcherWorkflow', id: DISPATCHER_WORKFLOW_ID},
      {
        name: 'outboxRetentionWorkflow',
        id: OUTBOX_RETENTION_WORKFLOW_ID,
        cronSchedule: '0 0 * * *',
      },
    ]);
  });
});
