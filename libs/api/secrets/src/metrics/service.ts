import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countPublicEntriesByResource} from '#db/index.js';

export function registerSecretsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('secrets');

  const publicEntries = meter.createObservableGauge('secrets_public_entries', {
    description: 'Public secret and variable entries currently stored, excluding system namespaces',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const counts = await countPublicEntriesByResource();
      observer.observe(publicEntries, counts.secrets, {resource: 'secret'});
      observer.observe(publicEntries, counts.variables, {resource: 'variable'});
    },
    [publicEntries],
  );
}
