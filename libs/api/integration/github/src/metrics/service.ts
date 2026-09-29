import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countStaleGithubUnlinkedInstallations} from '#db/unlinked-installations.js';

export function registerGithubServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('github');
  const unlinkedInstallations = meter.createObservableGauge(
    'integrations_github_unlinked_installations',
    {
      description:
        'GitHub installations seen through webhooks for more than one hour without a linked installation',
    },
  );

  meter.addBatchObservableCallback(
    async (observer) => {
      const count = await countStaleGithubUnlinkedInstallations();
      observer.observe(unlinkedInstallations, count);
    },
    [unlinkedInstallations],
  );
}
