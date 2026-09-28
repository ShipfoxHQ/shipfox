import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {ResolvedActions} from './entities/action-snapshot.js';
import {hasIntegrationToolReferences} from './has-integration-tool-references.js';

/**
 * Whether the document needs the integration validation context (connection
 * snapshot and provider event catalogs) to validate an integration-source
 * trigger, listening matcher, agent-step integration, tool step, or action
 * whose manifest declares integrations. The manual and cron checks are literal
 * and context-free.
 */
export function needsIntegrationValidationContext(
  document: WorkflowDocument,
  actionManifests?: ResolvedActions,
): boolean {
  const topLevelTriggers = Object.values(document.triggers ?? {});
  if (topLevelTriggers.some(isIntegrationTrigger)) return true;
  if (usesActionWithIntegrations(document, actionManifests)) return true;

  return (
    hasIntegrationToolReferences(document) ||
    Object.values(document.jobs).some(
      (job) =>
        job.listening?.on.some(isIntegrationTrigger) === true ||
        job.listening?.until?.some(isIntegrationTrigger) === true,
    )
  );
}

function isIntegrationTrigger(trigger: {source: string}): boolean {
  return trigger.source !== 'manual' && trigger.source !== 'cron';
}

function usesActionWithIntegrations(
  document: WorkflowDocument,
  actionManifests: ResolvedActions | undefined,
): boolean {
  if (actionManifests === undefined) return false;
  return Object.values(document.jobs).some((job) =>
    job.steps.some((step) => {
      if (step.uses === undefined) return false;
      const integrations = actionManifests.get(step.uses)?.manifest.integrations;
      return integrations !== undefined && Object.keys(integrations).length > 0;
    }),
  );
}
