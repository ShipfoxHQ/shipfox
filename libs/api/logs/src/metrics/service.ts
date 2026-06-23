import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getOpenStreamCount} from '#db/streams.js';

export function registerLogsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('logs');

  const openStreams = meter.createObservableGauge('logs_open_streams', {
    description: 'Log streams currently open for appends',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(openStreams, toSafeGaugeNumber(await getOpenStreamCount()));
    },
    [openStreams],
  );
}

function toSafeGaugeNumber(value: bigint): number {
  // OpenTelemetry gauges accept numbers; clamp unrepresentable DB counts rather than round them.
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return Number.MAX_SAFE_INTEGER;
}
