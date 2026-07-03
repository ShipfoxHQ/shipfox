import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getProjectCount} from '#db/projects.js';

export function registerProjectsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('projects');

  const projectCount = meter.createObservableGauge('projects_project_count', {
    description: 'Projects currently stored',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(projectCount, await getProjectCount());
    },
    [projectCount],
  );
}
