import {useClientAnalytics, useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Panel, PanelBody} from '@shipfox/react-ui/panel';
import {useCallback, useId, useState} from 'react';
import {type HomePanel, selectHomePanel} from '#core/home-panel.js';
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
import {useToolsStep} from '#hooks/use-tools-step.js';
import {FirstWorkflowPanel} from './first-workflow-panel.js';
import {SetupChecklistBody} from './setup-checklist-body.js';
import {FirstWorkflowCelebration, SetupChecklistCompletion} from './setup-checklist-completion.js';
import {
  type ChecklistExpansionControl,
  ChecklistHeader,
  checklistCountLabel,
} from './setup-checklist-host-primitives.js';
import {SetupChecklistNextStep} from './setup-checklist-next-step.js';
import type {WorkspaceReference, WorkspaceSetupChecklistProps} from './setup-checklist-types.js';
import {ToolsStepPanel} from './tools-step-panel.js';

export function WorkspaceSetupChecklist(props: WorkspaceSetupChecklistProps = {}) {
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
  const toolsStep = useToolsStep(workspace.id);
  const {expanded, toggle: toggleExpansion} = useChecklistExpansion(workspace.id);
  const queryState = useSetupChecklistQueryState({
    workspaceId: workspace.id,
    subscribed: !dismissal.dismissed,
    toolsStepFinished: toolsStep.finished,
  });
  const bodyId = useId();
  const [burstPending, setBurstPending] = useState(false);
  const handleCompleted = useCallback((completed: boolean) => {
    if (completed) setBurstPending(true);
  }, []);
  const showCompletion = useCompletionTransition(queryState, 'panel', handleCompleted);
  const firstWorkflowCelebrating = useFirstWorkflowActivation(queryState);
  const [firstWorkflowBurstPlayed, setFirstWorkflowBurstPlayed] = useState(false);
  const [toolsStepLeft, setToolsStepLeft] = useState(false);
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
  const connectedToolCount = queryState.integrations.readiness.providers.filter(
    (provider) => provider.connected && !provider.capabilities.includes('source_control'),
  ).length;
  const finishToolsStep = useCallback(() => {
    toolsStep.finish();
    setToolsStepLeft(true);
    analytics.capture('onboarding_tools_step_finished', {
      outcome: connectedToolCount > 0 ? 'continued' : 'skipped',
      connected_count: connectedToolCount,
    });
  }, [analytics, connectedToolCount, toolsStep]);

  // The slot sits above the page's own content, so it stays out of the layout
  // until the reads that pick the panel have settled. Anything less could still
  // turn out to be a finished workspace and take the panel away a moment later.
  const panel = selectHomePanel({
    dismissed: dismissal.dismissed,
    settled: queryState.baseSettled && queryState.firstWorkflowSettled,
    integrationsLoaded: queryState.integrations.loaded,
    toolsStepFinished: toolsStep.finished,
    firstWorkflow: queryState.firstWorkflow,
    canRunWorkflows: queryState.canRunWorkflows,
    checklistVisible: queryState.checklist.openCount > 0 || showCompletion,
  });
  useShownAnalytics('panel', panel !== 'none');
  const nextStep = selectNextSetupStep(queryState.checklist);
  useFirstWorkflowTestRunShown(
    'panel',
    !showCompletion &&
      queryState.firstWorkflow?.state === 'test_run_succeeded' &&
      showsFirstWorkflow({panel, expanded, nextStepId: nextStep?.id}),
  );

  if (panel === 'none') return null;

  if (panel === 'tools') {
    return (
      <ToolsStepPanel
        workspaceSlug={workspace.slug}
        providers={queryState.integrations.providers}
        connections={queryState.integrations.connections}
        connectedCount={connectedToolCount}
        onFinish={finishToolsStep}
        onDismiss={dismiss}
      />
    );
  }

  if (panel === 'first-workflow') {
    const progress = queryState.firstWorkflow;
    if (!progress || progress.state === 'done') return null;
    return (
      <FirstWorkflowPanel
        workspace={workspace}
        progress={progress}
        surface="home"
        onDismiss={dismiss}
        focusTitle={toolsStepLeft}
      />
    );
  }

  const expandable = !showCompletion && queryState.checklist.items.length > 1;

  // `trackedCount` only stops moving once the runner and model-provider families
  // report, so a count shown before then can read "3 of 3 done" over rows that
  // have yet to arrive.
  const countLabel = queryState.trackedRowsSettled
    ? checklistCountLabel(queryState.checklist)
    : undefined;

  const expansionControl: ChecklistExpansionControl | undefined = expandable
    ? {expanded, bodyId, onToggle: handleToggleExpansion}
    : undefined;

  return (
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
}

/** The first-workflow panel, or a checklist that has the first-workflow row on screen. */
function showsFirstWorkflow({
  panel,
  expanded,
  nextStepId,
}: {
  panel: HomePanel;
  expanded: boolean;
  nextStepId: SetupChecklistItem['id'] | undefined;
}): boolean {
  if (panel === 'first-workflow') return true;
  return panel === 'checklist' && (expanded || nextStepId === 'first-workflow');
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
