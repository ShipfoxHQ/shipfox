import type {FirstWorkflowProgress} from './setup-checklist.js';

export type HomePanel = 'none' | 'tools' | 'first-workflow' | 'checklist';

export interface HomePanelInput {
  /** The setup guide is hidden on this device. */
  dismissed: boolean;
  /** The providers, connections, and first-workflow reads have each settled. */
  settled: boolean;
  /** The providers and connections reads have both answered once. */
  integrationsLoaded: boolean;
  toolsStepFinished: boolean;
  /** Undefined when the first-workflow read has no answer. */
  firstWorkflow: FirstWorkflowProgress | undefined;
  /** Runners and a model are known to be available. */
  canRunWorkflows: boolean;
  /** A tracked row is open, or the completion state is showing. */
  checklistVisible: boolean;
}

/**
 * The one onboarding panel the home shows. It is separate from checklist
 * completion: a connected tool marks the tools row done at once, but the tools
 * panel stays until the reader presses its button, so the number of connected
 * tools is not a condition here. Unknown first-workflow progress matches
 * neither the tools nor the first-workflow panel, because a finished workspace
 * would otherwise see a panel until the read answers.
 */
export function selectHomePanel({
  dismissed,
  settled,
  integrationsLoaded,
  toolsStepFinished,
  firstWorkflow,
  canRunWorkflows,
  checklistVisible,
}: HomePanelInput): HomePanel {
  if (dismissed || !settled) return 'none';
  if (!toolsStepFinished && firstWorkflow?.state === 'open' && integrationsLoaded) return 'tools';
  if (firstWorkflow !== undefined && firstWorkflow.state !== 'done' && canRunWorkflows) {
    return 'first-workflow';
  }
  return checklistVisible ? 'checklist' : 'none';
}
