import {getServiceMetricsProvider, logger} from '@shipfox/node-opentelemetry';
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
      try {
        const count = await countStaleGithubUnlinkedInstallations();
        observer.observe(unlinkedInstallations, count);
      } catch (error) {
        logger().warn({err: error}, 'Failed to collect GitHub unlinked installation metrics');
      }
    },
    [unlinkedInstallations],
  );
}
