import {countPendingOutboxRows, type ModuleRuntimeContext} from '@shipfox/node-module';
import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';

export function registerDispatcherServiceMetrics(context: ModuleRuntimeContext): void {
  const meter = getServiceMetricsProvider().getMeter('dispatcher');

  const pendingEvents = meter.createObservableGauge('dispatcher_pending_events', {
    description: 'Outbox events awaiting dispatch, including claimed and retry-delayed events',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(pendingEvents, await countPendingOutboxRows(context.outboxRegistry));
    },
    [pendingEvents],
  );
}
