import {
  DISPATCHER_WORKER_COUNT,
  DISPATCHER_WORKFLOW_ID,
  OUTBOX_RETENTION_WORKFLOW_ID,
} from '#core/constants.js';
import {createDispatcherModule} from './module.js';

describe('dispatcherModule', () => {
  it('registers the Temporal dispatch workflows alongside retention when the in-process drainer is disabled', () => {
    const module = createDispatcherModule({enabled: false});
    const worker = module.workers?.[0];

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

  it('registers only the retention workflow on Temporal when the in-process drainer is enabled, so the two dispatchers never race the same rows', () => {
    const module = createDispatcherModule({enabled: true, pollMs: 250});
    const worker = module.workers?.[0];

    expect(worker?.workflows).toEqual([
      {
        name: 'outboxRetentionWorkflow',
        id: OUTBOX_RETENTION_WORKFLOW_ID,
        cronSchedule: '0 0 * * *',
      },
    ]);
    expect(module.services?.[0]?.name).toBe('outbox-drainer');
  });

  it('does not register the in-process drainer when disabled', () => {
    const module = createDispatcherModule({enabled: false});

    expect(module.services).toBeUndefined();
  });

  it('registers the in-process drainer with the configured poll interval', async () => {
    const module = createDispatcherModule({pollMs: 500});
    const service = module.services?.[0];

    expect(service?.name).toBe('outbox-drainer');
    const handle = await service?.start();
    await handle?.stop();

    expect(handle).toMatchObject({stop: expect.any(Function)});
  });
});
