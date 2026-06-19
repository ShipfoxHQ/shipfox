import {createSentryMaintenanceWorker} from './index.js';

describe('createSentryMaintenanceWorker', () => {
  test('describes the sentry maintenance worker', () => {
    const worker = createSentryMaintenanceWorker();

    expect(worker.taskQueue).toBe('integrations-sentry-maintenance');
    expect(worker.workflowsPath.endsWith('dist/temporal/workflows/index.js')).toBe(true);
    expect(Object.keys(worker.activities())).toContain('pruneUnclaimedSentryInstallationsActivity');
    expect(worker.workflows).toEqual([
      {
        name: 'pruneUnclaimedSentryInstallationsCron',
        id: 'sentry-prune-unclaimed-installations',
        cronSchedule: '0 4 * * *',
      },
    ]);
  });
});
