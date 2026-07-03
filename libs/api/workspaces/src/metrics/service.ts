import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getWorkspaceServiceMetrics} from '#db/workspaces.js';

export function registerWorkspacesServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('workspaces');

  const activeWorkspaces = meter.createObservableGauge('workspaces_active', {
    description: 'Workspaces currently marked active',
  });
  const memberships = meter.createObservableGauge('workspaces_memberships', {
    description: 'Workspace memberships currently present',
  });
  const openInvitations = meter.createObservableGauge('workspaces_open_invitations', {
    description: 'Workspace invitations currently unaccepted and unexpired',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const metrics = await getWorkspaceServiceMetrics();
      observer.observe(activeWorkspaces, metrics.activeWorkspaces);
      observer.observe(memberships, metrics.memberships);
      observer.observe(openInvitations, metrics.openInvitations);
    },
    [activeWorkspaces, memberships, openInvitations],
  );
}
