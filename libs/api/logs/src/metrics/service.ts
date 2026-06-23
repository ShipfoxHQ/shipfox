import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getOpenStreamCount} from '#db/streams.js';

export function registerLogsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('logs');

  const openStreams = meter.createObservableGauge('logs_open_streams', {
    description: 'Log streams currently open for appends',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(openStreams, await getOpenStreamCount());
    },
    [openStreams],
  );
}
