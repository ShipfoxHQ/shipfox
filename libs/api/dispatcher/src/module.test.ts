import {
  DISPATCHER_WORKER_COUNT,
  DISPATCHER_WORKFLOW_ID,
  OUTBOX_RETENTION_WORKFLOW_ID,
} from '#core/constants.js';
import {dispatcherModule} from './module.js';

describe('dispatcherModule', () => {
  it('registers dispatch and retention workflows on the dispatcher worker', () => {
    const worker = dispatcherModule.workers?.[0];

    expect(worker?.workflows).toEqual([
      {
        name: 'outboxDispatcherWorkflow',
        id: DISPATCHER_WORKFLOW_ID,
        args: [{workerIndex: 0, workerCount: DISPATCHER_WORKER_COUNT}],
      },
      ...Array.from({length: DISPATCHER_WORKER_COUNT - 1}, (_, index) => {
        const workerIndex = index + 1;
        return {
          name: 'outboxDispatcherWorkflow',
          id: `${DISPATCHER_WORKFLOW_ID}-${workerIndex}`,
          args: [{workerIndex, workerCount: DISPATCHER_WORKER_COUNT}],
        };
      }),
      {
        name: 'outboxRetentionWorkflow',
        id: OUTBOX_RETENTION_WORKFLOW_ID,
        cronSchedule: '0 0 * * *',
      },
    ]);
  });
});
