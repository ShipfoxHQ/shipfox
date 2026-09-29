import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countStaleGithubUnlinkedInstallations} from '#db/unlinked-installations.js';

export function registerGithubServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('github');
  const unlinkedInstallations = meter.createObservableGauge(
    'integrations_github_unlinked_installations',
    {description: 'GitHub installations seen by webhook but not linked for over one hour'},
  );

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(unlinkedInstallations, await countStaleGithubUnlinkedInstallations());
    },
    [unlinkedInstallations],
  );
}
