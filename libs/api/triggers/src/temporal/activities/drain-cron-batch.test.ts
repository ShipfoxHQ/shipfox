import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';

vi.mock('@temporalio/activity', () => ({Context: {current: () => ({heartbeat: vi.fn()})}}));
vi.mock('#config.js', () => ({
  config: {
    TRIGGER_CRON_FANOUT: 2,
    TRIGGER_CRON_CLAIM_BATCH: 100,
    TRIGGER_CRON_JITTER_WINDOW_SECONDS: 0,
  },
}));
vi.mock('#core/drain-cron-schedules.js', () => ({drainDueCronSchedules: vi.fn()}));

const {drainDueCronSchedules} = await import('#core/drain-cron-schedules.js');
const {runCronTickActivity} = await import('./drain-cron-batch.js');

const workflows = {} as WorkflowsModuleClient;
const secrets = {getSecret: vi.fn()};

describe('runCronTickActivity', () => {
  beforeEach(() => {
    vi.mocked(drainDueCronSchedules).mockReset();
  });

  it('runs one drain per fanout slot and sums their summaries', async () => {
    vi.mocked(drainDueCronSchedules)
      .mockResolvedValueOnce({claimed: 3, fired: 2, errored: 1, retried: 0})
      .mockResolvedValueOnce({claimed: 4, fired: 3, errored: 0, retried: 1});

    const summary = await runCronTickActivity(workflows, secrets);

    expect(drainDueCronSchedules).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({fired: 5, errored: 1, retried: 1});
  });

  it('waits for every drain before failing on a rejected one', async () => {
    let otherSettled = false;
    vi.mocked(drainDueCronSchedules)
      .mockRejectedValueOnce(new Error('database down'))
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        otherSettled = true;
        return {claimed: 0, fired: 0, errored: 0, retried: 0};
      });

    await expect(runCronTickActivity(workflows, secrets)).rejects.toThrow('database down');
    expect(otherSettled).toBe(true);
  });
});
