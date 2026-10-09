import type {WorkspaceIntegrationReadiness} from './integration-readiness.js';

export type SetupChecklistItemStatus = 'done' | 'open' | 'info';

export type SetupChecklistItemId =
  | 'source-control'
  | 'project'
  | 'tools'
  | 'runner'
  | 'model-provider'
  | 'first-workflow'
  | 'teammates';

/** Every destination the checklist routes to. Keeps action routing total. */
export type SetupChecklistActionHref =
  | '/'
  | '/runs/$workflowRunId'
  | '/settings/agents'
  | '/settings/integrations'
  | '/setup/members'
  | '/settings/runners';

export type SetupChecklistAction =
  | {label: string; href: Exclude<SetupChecklistActionHref, '/runs/$workflowRunId'>}
  | {label: string; href: '/runs/$workflowRunId'; workflowRunId: string};

/**
 * Where the workspace stands on its first workflow. A succeeded dev run is the
 * only fact behind the middle state: it claims neither which workflow ran nor
 * that a pull request exists.
 */
export type FirstWorkflowProgress =
  | {state: 'open'}
  | {state: 'test_run_succeeded'; testRunId: string}
  | {state: 'done'};

export type FirstWorkflowState = FirstWorkflowProgress['state'];

export interface SetupChecklistItem {
  id: SetupChecklistItemId;
  title: string;
  status: SetupChecklistItemStatus;
  /** Tracked items count toward completion; pointers never do. */
  tracked: boolean;
  /** The row's underlying integration has a connection that needs attention. */
  attention?: boolean;
  /** One line of purpose, rendered for open and pointer rows. */
  purpose?: string;
  /** Primary action, a link to where the work happens. */
  action?: SetupChecklistAction;
}

export interface SetupChecklist {
  /** Rows in spec order: done progress, activation asks, then pointers. */
  items: readonly SetupChecklistItem[];
  /** Open tracked rows. */
  openCount: number;
  /** Rows that count toward completion. */
  trackedCount: number;
  /** True when every tracked row is done. */
  complete: boolean;
}

export interface SetupChecklistInput {
  readiness: WorkspaceIntegrationReadiness;
  installationRunners: 'managed' | 'none';
  workspaceRunnerCapacity: boolean;
  modelProvider: {installationProvided: boolean; configured: boolean};
  membership: {memberCount: number; pendingInvitationCount: number};
  /** Undefined when the first-workflow read has no answer, which reads as `open`. */
  firstWorkflow: FirstWorkflowProgress | undefined;
  /** The reader skipped or continued past the tools step on this device. */
  toolsStepFinished: boolean;
}

const TOOLS_TITLE = 'Connect your tools';
const TOOLS_PURPOSE =
  'Connect issue tracking, messaging, observability, or any Shipfox integration';
const RUNNER_PURPOSE = 'Jobs wait in `pending` until a runner is online';
const MODEL_PROVIDER_PURPOSE = 'Agent steps need a model provider to run';
const FIRST_WORKFLOW_TITLE = 'Create your first workflow';
const FIRST_WORKFLOW_PURPOSE = 'Your coding agent sets it up from a template';
const TEST_RUN_SUCCEEDED_TITLE = 'A test run succeeded';
const TEST_RUN_SUCCEEDED_PURPOSE =
  'Merge the workflow pull request from your coding agent to turn the workflow on';
const TEAMMATES_PURPOSE = 'Everyone in the workspace can edit workflows and see runs';

/**
 * Derives the workspace setup checklist from integration readiness and the
 * runner, model-provider, first-workflow, and membership facts. Rows follow the
 * spec order; the runner and model-provider rows exist only when the
 * installation does not already provide the capability.
 */
export function deriveSetupChecklist({
  readiness,
  installationRunners,
  workspaceRunnerCapacity,
  modelProvider,
  membership,
  firstWorkflow,
  toolsStepFinished,
}: SetupChecklistInput): SetupChecklist {
  const toolsAttention =
    !readiness.hasToolIntegration && attentionToolProviders(readiness).length > 0;
  // Tools are asked for before the first workflow only. Past that point a
  // workspace without a tool is still set up, so the row turns into a pointer.
  const toolsPointer =
    !readiness.hasToolIntegration &&
    (toolsStepFinished || (firstWorkflow !== undefined && firstWorkflow.state !== 'open'));
  const items: SetupChecklistItem[] = [
    {id: 'source-control', title: 'Connect source control', status: 'done', tracked: true},
    {id: 'project', title: 'Create a project', status: 'done', tracked: true},
    {
      id: 'tools',
      title: toolsTitle(readiness),
      status: toolsStatus(readiness.hasToolIntegration, toolsPointer),
      tracked: !toolsPointer,
      attention: toolsAttention,
      purpose: TOOLS_PURPOSE,
      action: {label: 'Connect', href: '/settings/integrations'},
    },
  ];

  if (installationRunners === 'none') {
    items.push({
      id: 'runner',
      title: 'Set up runner capacity',
      status: workspaceRunnerCapacity ? 'done' : 'open',
      tracked: true,
      purpose: RUNNER_PURPOSE,
      action: {label: 'Set up', href: '/settings/runners'},
    });
  }

  if (!modelProvider.installationProvided) {
    items.push({
      id: 'model-provider',
      title: 'Configure a model provider',
      status: modelProvider.configured ? 'done' : 'open',
      tracked: true,
      purpose: MODEL_PROVIDER_PURPOSE,
      action: {label: 'Configure', href: '/settings/agents'},
    });
  }

  items.push(firstWorkflowItem(firstWorkflow ?? {state: 'open'}), {
    id: 'teammates',
    title: 'Invite your teammates',
    status: membership.memberCount >= 2 || membership.pendingInvitationCount >= 1 ? 'done' : 'info',
    tracked: false,
    purpose: TEAMMATES_PURPOSE,
    action: {label: 'Invite', href: '/setup/members'},
  });

  const trackedItems = items.filter((item) => item.tracked);
  const openCount = trackedItems.filter((item) => item.status === 'open').length;

  return {
    items,
    openCount,
    trackedCount: trackedItems.length,
    complete: openCount === 0,
  };
}

function toolsStatus(connected: boolean, pointer: boolean): SetupChecklistItemStatus {
  if (connected) return 'done';
  return pointer ? 'info' : 'open';
}

function firstWorkflowItem(progress: FirstWorkflowProgress): SetupChecklistItem {
  switch (progress.state) {
    case 'open':
      return {
        id: 'first-workflow',
        title: FIRST_WORKFLOW_TITLE,
        status: 'open',
        tracked: true,
        purpose: FIRST_WORKFLOW_PURPOSE,
        action: {label: 'Choose a workflow', href: '/'},
      };
    case 'test_run_succeeded':
      return {
        id: 'first-workflow',
        title: TEST_RUN_SUCCEEDED_TITLE,
        status: 'open',
        tracked: true,
        purpose: TEST_RUN_SUCCEEDED_PURPOSE,
        action: {
          label: 'View run',
          href: '/runs/$workflowRunId',
          workflowRunId: progress.testRunId,
        },
      };
    case 'done':
      return {id: 'first-workflow', title: FIRST_WORKFLOW_TITLE, status: 'done', tracked: true};
  }
}

function toolsTitle(readiness: WorkspaceIntegrationReadiness): string {
  if (!readiness.hasToolIntegration) {
    const providers = attentionToolProviders(readiness);
    if (providers.length === 1) {
      const provider = providers[0];
      if (provider !== undefined) {
        return `${provider.displayName || provider.provider} needs attention`;
      }
    }
    if (providers.length > 1) {
      return `${providers.length} integrations need attention`;
    }
  }
  return TOOLS_TITLE;
}

function attentionToolProviders(readiness: WorkspaceIntegrationReadiness) {
  return readiness.attentionProviders
    .map((providerKey) => readiness.providers.find(({provider}) => provider === providerKey))
    .filter(
      (provider) => provider !== undefined && !provider.capabilities.includes('source_control'),
    );
}

/**
 * The single step a compact host asks for: the first open tracked row, or the
 * first unfinished pointer once every tracked row is done but the checklist has
 * not settled as complete.
 */
export function selectNextSetupStep(checklist: SetupChecklist): SetupChecklistItem | undefined {
  return (
    checklist.items.find((item) => item.tracked && item.status === 'open') ??
    checklist.items.find((item) => item.status !== 'done')
  );
}
