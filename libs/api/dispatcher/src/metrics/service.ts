import {countPendingOutboxRows} from '@shipfox/node-module';
import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';

export function registerDispatcherServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('dispatcher');

  const pendingEvents = meter.createObservableGauge('dispatcher_pending_events', {
    description: 'Outbox events awaiting dispatch, including claimed and retry-delayed events',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(pendingEvents, await countPendingOutboxRows());
    },
    [pendingEvents],
  );
}
