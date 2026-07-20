import {registerPublisher, resetPublishers} from '@shipfox/node-module';
import {createOutboxTable} from '@shipfox/node-outbox';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {pgTableCreator} from 'drizzle-orm/pg-core';
import {OUTBOX_RETENTION_WORKFLOW_ID} from '#core/constants.js';
import {createDispatcherModule} from './module.js';

const mocks = vi.hoisted(() => ({
  createOutboxDrainerService: vi.fn(() => ({
    name: 'outbox-drainer',
    shutdownTimeoutMs: 5_000,
    start: vi.fn(),
  })),
  info: vi.fn(),
}));

vi.mock('#core/outbox-drainer-service.js', () => ({
  createOutboxDrainerService: mocks.createOutboxDrainerService,
}));

vi.mock('@shipfox/node-opentelemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-opentelemetry')>()),
  logger: () => ({info: mocks.info}),
}));

const table = createOutboxTable(pgTableCreator((name) => name));
const db = (() => undefined) as unknown as () => NodePgDatabase<Record<string, unknown>>;

describe('dispatcherModule', () => {
  beforeEach(() => {
    resetPublishers();
    mocks.createOutboxDrainerService.mockClear();
    mocks.info.mockReset();
  });

  afterEach(() => {
    resetPublishers();
  });

  it('registers only the retention workflow on Temporal and does not start the drainer when disabled', () => {
    const module = createDispatcherModule({enabled: false});
    const worker = module.workers?.[0];

    expect(worker?.workflows).toEqual([
      {
        name: 'outboxRetentionWorkflow',
        id: OUTBOX_RETENTION_WORKFLOW_ID,
        cronSchedule: '0 0 * * *',
      },
    ]);
    expect(module.services).toBeUndefined();
  });

  it('registers the drainer service without adding Temporal dispatch workflows', () => {
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
    expect(module.metrics).toBeDefined();
  });

  it('passes the configured poll interval to the in-process drainer', () => {
    const module = createDispatcherModule({pollMs: 500});

    expect(mocks.createOutboxDrainerService).toHaveBeenCalledWith({pollMs: 500});
    expect(module.services?.[0]?.name).toBe('outbox-drainer');
  });

  it('fails boot when its publisher registry is empty', () => {
    const startupTasks = createDispatcherModule({enabled: false}).startupTasks;

    expect(startupTasks).toThrow(
      'duplicate @shipfox/node-module instance split the publisher registry',
    );
  });

  it('logs registered publisher names at boot', async () => {
    registerPublisher({name: 'auth', table, db});
    registerPublisher({name: 'workspaces', table, db});
    const startupTasks = createDispatcherModule({enabled: false}).startupTasks;

    await startupTasks?.();

    expect(mocks.info).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledWith(
      {publisherCount: 2, publisherNames: ['auth', 'workspaces']},
      'Outbox dispatcher publishers registered',
    );
  });
});
