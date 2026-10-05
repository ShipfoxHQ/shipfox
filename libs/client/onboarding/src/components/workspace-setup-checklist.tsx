import {useClientAnalytics, useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Panel, PanelBody} from '@shipfox/react-ui/panel';
import {useCallback, useId, useState} from 'react';
import {type SetupChecklistItem, selectNextSetupStep} from '#core/setup-checklist.js';
import {type ChecklistQueryState, useSetupChecklistQueryState} from '#hooks/api/setup-checklist.js';
import {
  useCompletionTransition,
  useFirstWorkflowActivation,
  useFirstWorkflowTestRunShown,
  useShownAnalytics,
} from '#hooks/use-checklist-analytics.js';
import {useChecklistDismissal} from '#hooks/use-checklist-dismissal.js';
import {useChecklistExpansion} from '#hooks/use-checklist-expansion.js';
import {FirstWorkflowPanel, type FirstWorkflowPanelProgress} from './first-workflow-panel.js';
import {SetupChecklistBody} from './setup-checklist-body.js';
import {FirstWorkflowCelebration, SetupChecklistCompletion} from './setup-checklist-completion.js';
import {
  type ChecklistExpansionControl,
  ChecklistHeader,
  checklistCountLabel,
} from './setup-checklist-host-primitives.js';
import {SetupChecklistNextStep} from './setup-checklist-next-step.js';
import type {WorkspaceReference, WorkspaceSetupHostProps} from './setup-checklist-types.js';

export function WorkspaceSetupChecklist(props: WorkspaceSetupHostProps = {}) {
  if (props.workspace) {
    return (
      <WorkspaceSetupChecklistForWorkspace key={props.workspace.id} workspace={props.workspace} />
    );
  }

  return <WorkspaceSetupChecklistFromShell />;
}

function WorkspaceSetupChecklistFromShell() {
  const workspace = useMaybeActiveWorkspace();
  return workspace ? (
    <WorkspaceSetupChecklistForWorkspace key={workspace.id} workspace={workspace} />
  ) : null;
}

function WorkspaceSetupChecklistForWorkspace({workspace}: {workspace: WorkspaceReference}) {
  const dismissal = useChecklistDismissal(workspace.id);
  const {expanded, toggle: toggleExpansion} = useChecklistExpansion(workspace.id);
  const queryState = useSetupChecklistQueryState(workspace.id, !dismissal.dismissed);
  const bodyId = useId();
  const [burstPending, setBurstPending] = useState(false);
  const handleCompleted = useCallback((completed: boolean) => {
    if (completed) setBurstPending(true);
  }, []);
  const showCompletion = useCompletionTransition(queryState, 'panel', handleCompleted);
  const firstWorkflowCelebrating = useFirstWorkflowActivation(queryState);
  const [firstWorkflowBurstPlayed, setFirstWorkflowBurstPlayed] = useState(false);
  const analytics = useClientAnalytics();
  const consumeBurst = useCallback(() => setBurstPending(false), []);
  const consumeFirstWorkflowBurst = useCallback(() => setFirstWorkflowBurstPlayed(true), []);

  const dismiss = useCallback(() => {
    dismissal.dismiss();
    analytics.capture('onboarding_checklist_dismissed', {host: 'panel'});
  }, [analytics, dismissal]);
  const handleAction = useCallback(
    (item: SetupChecklistItem) => {
      analytics.capture('onboarding_checklist_row_clicked', {row_id: item.id});
    },
    [analytics],
  );
  const handleToggleExpansion = useCallback(() => {
    toggleExpansion();
    analytics.capture('onboarding_checklist_expansion_toggled', {
      host: 'panel',
      expanded: !expanded,
    });
  }, [analytics, expanded, toggleExpansion]);
  // The panel sits above the page's own content, so it stays out of the layout
  // until a loaded family reports an open tracked step. Rows stay hidden while
  // their family loads, so anything less could still turn out to be a finished
  // workspace and take the panel away a moment later.
  const isVisible =
    !dismissal.dismissed &&
    queryState.baseSettled &&
    (queryState.checklist.openCount > 0 || showCompletion);
  useShownAnalytics('panel', isVisible);
  const nextStep = selectNextSetupStep(queryState.checklist);
  useFirstWorkflowTestRunShown(
    'panel',
    isVisible &&
      !showCompletion &&
      queryState.firstWorkflow?.state === 'test_run_succeeded' &&
      (expanded || nextStep?.id === 'first-workflow'),
  );

  if (!isVisible) return null;

  const expandable = !showCompletion && queryState.checklist.items.length > 1;

  // `trackedCount` only stops moving once the runner and model-provider families
  // report, so a count shown before then can read "3 of 3 done" over rows that
  // have yet to arrive.
  const countLabel = queryState.trackedRowsSettled
    ? checklistCountLabel(queryState.checklist)
    : undefined;

  const expansionControl: ChecklistExpansionControl | undefined = expandable
    ? {
        expanded,
        stepCount: queryState.checklist.items.length,
        bodyId,
        onToggle: handleToggleExpansion,
      }
    : undefined;

  const firstWorkflowPanelProgress = homeFirstWorkflowPanelProgress(queryState);
  const checklistPanel = (
    <Panel asChild className="w-full">
      <section aria-label="Get started">
        <ChecklistHeader count={countLabel} expansion={expansionControl} onDismiss={dismiss} />
        <PanelBody id={bodyId}>
          <ChecklistPanelBody
            queryState={queryState}
            workspaceSlug={workspace.slug}
            expanded={expanded}
            completion={showCompletion}
            showBurst={burstPending}
            onBurstComplete={consumeBurst}
            firstWorkflowCelebration={
              firstWorkflowCelebrating
                ? {showBurst: !firstWorkflowBurstPlayed, onBurstComplete: consumeFirstWorkflowBurst}
                : undefined
            }
            onAction={handleAction}
            onDone={dismiss}
          />
        </PanelBody>
      </section>
    </Panel>
  );

  if (!firstWorkflowPanelProgress) return checklistPanel;

  return (
    <>
      {checklistPanel}
      <FirstWorkflowPanel
        workspace={workspace}
        progress={firstWorkflowPanelProgress}
        surface="home"
      />
    </>
  );
}

/**
 * The home offers the first workflow only once a run could succeed: runners and
 * a model are known to be available and the workspace has no definition. It
 * reads those facts rather than row visibility, since the checklist hides a row
 * while its family loads, and it does not wait on the tools row, which a
 * GitHub-only workspace never finishes.
 */
function homeFirstWorkflowPanelProgress(
  queryState: ChecklistQueryState,
): FirstWorkflowPanelProgress | undefined {
  const progress = queryState.firstWorkflow;
  if (!queryState.canRunWorkflows || !progress || progress.state === 'done') return undefined;
  return progress;
}

/**
 * The panel stays at one step until the reader asks for the list, because it
 * sits above the page's own content. The nav-bar indicator carries the full
 * checklist on every route.
 */
function ChecklistPanelBody({
  queryState,
  workspaceSlug,
  expanded,
  completion,
  showBurst,
  onBurstComplete,
  firstWorkflowCelebration,
  onAction,
  onDone,
}: {
  queryState: ChecklistQueryState;
  workspaceSlug: string;
  expanded: boolean;
  completion: boolean;
  showBurst: boolean;
  onBurstComplete: () => void;
  firstWorkflowCelebration: {showBurst: boolean; onBurstComplete: () => void} | undefined;
  onAction: (item: SetupChecklistItem) => void;
  onDone: () => void;
}) {
  if (completion) {
    return (
      <SetupChecklistCompletion
        standalone
        showBurst={showBurst}
        onBurstComplete={onBurstComplete}
        onDone={onDone}
      />
    );
  }

  const celebration = firstWorkflowCelebration ? (
    <FirstWorkflowCelebration
      showBurst={firstWorkflowCelebration.showBurst}
      onBurstComplete={firstWorkflowCelebration.onBurstComplete}
    />
  ) : null;

  if (expanded) {
    return (
      <>
        {celebration}
        <SetupChecklistBody
          checklist={queryState.checklist}
          workspaceSlug={workspaceSlug}
          onAction={onAction}
        />
      </>
    );
  }

  const nextStep = selectNextSetupStep(queryState.checklist);
  if (!nextStep) return celebration;

  return (
    <>
      {celebration}
      <SetupChecklistNextStep item={nextStep} workspaceSlug={workspaceSlug} onAction={onAction} />
    </>
  );
}
