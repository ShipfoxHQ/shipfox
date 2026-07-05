import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countDueCronSchedules} from '#db/cron-schedules.js';

export function registerTriggersServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('triggers');

  const cronBacklog = meter.createObservableGauge('triggers_cron_backlog', {
    description:
      'Cron schedules past their next fire time and still pending a fire (including any a drain is mid-flight on). A sustained nonzero value means the minute tick is falling behind; raise TRIGGER_CRON_FANOUT, TRIGGER_CRON_CLAIM_BATCH, or pod count.',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(cronBacklog, await countDueCronSchedules());
    },
    [cronBacklog],
  );
}
