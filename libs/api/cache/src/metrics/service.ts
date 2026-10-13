import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {sumStoredBytes} from '#db/entries.js';

export function registerCacheServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('cache');

  // On the service plane: the rows live in shared Postgres, so every pod would report the same
  // sum and Prometheus must not add them together.
  meter
    .createObservableGauge('cache_stored_bytes', {
      description: 'Bytes of committed cache entries across all workspaces',
      unit: 'By',
    })
    .addCallback(async (observer) => {
      observer.observe(await sumStoredBytes());
    });
}
