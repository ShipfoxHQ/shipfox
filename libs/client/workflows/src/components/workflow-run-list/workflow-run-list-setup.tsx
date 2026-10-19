import type {Definition, DefinitionSyncSummary} from '@shipfox/client-projects';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Panel, PanelActions, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Code, Text} from '@shipfox/react-ui/typography';
import type {ReactNode} from 'react';

/**
 * What a project without a live run needs above its run list: a sync error that merging
 * cannot fix, then either the first-workflow panel or the live workflows still waiting for
 * their trigger. Renders nothing when none applies.
 */
export function WorkflowRunListSetup({
  sync,
  firstWorkflowPanel,
  definitions,
  onRunDefinition,
  runningDefinitionId,
}: {
  sync: DefinitionSyncSummary | null;
  /** The composing application's first-workflow panel, shown until a workflow is merged. */
  firstWorkflowPanel: ReactNode;
  definitions: Definition[];
  onRunDefinition: (definition: Definition) => void;
  runningDefinitionId: string | null;
}) {
  const syncError = syncErrorMessage(sync);
  const setupPanel =
    definitions.length > 0 ? (
      <WaitingWorkflowsPanel
        definitions={definitions}
        defaultBranch={sync?.ref ?? null}
        onRun={onRunDefinition}
        runningDefinitionId={runningDefinitionId}
      />
    ) : (
      firstWorkflowPanel
    );
  if (!syncError && !setupPanel) return null;

  return (
    <>
      {syncError ? (
        <Callout type="error" role="alert">
          <div className="flex flex-col gap-tight">
            <Text size="sm" bold>
              Shipfox can't read this repository's workflows.
            </Text>
            <Text size="sm">{syncError}</Text>
          </div>
        </Callout>
      ) : null}
      {setupPanel}
    </>
  );
}

/** Explains the dev runs the list shows while the project has no live run. */
export function WorkflowRunListDevRunsNotice() {
  return (
    <div className="px-row py-row">
      <Callout type="info">
        <Text size="sm">
          No live runs yet. Dev runs start from a branch or a local file and don't need the workflow
          to be merged.
        </Text>
      </Callout>
    </div>
  );
}

/** The unfiltered run list of a project that has never run anything. */
export function WorkflowRunListNoRuns({defaultBranch}: {defaultBranch: string | null}) {
  return (
    <EmptyState
      icon="pulseLine"
      title="No runs yet"
      description={
        <>
          Dev runs show up here as soon as one starts. Live runs start once a workflow is merged
          into <BranchName branch={defaultBranch} />.
        </>
      }
      variant="panel"
    />
  );
}

function WaitingWorkflowsPanel({
  definitions,
  defaultBranch,
  onRun,
  runningDefinitionId,
}: {
  definitions: Definition[];
  defaultBranch: string | null;
  onRun: (definition: Definition) => void;
  runningDefinitionId: string | null;
}) {
  return (
    <Panel aria-label="Live workflows waiting for a trigger">
      <PanelHeader className="flex-col items-start gap-tight">
        <PanelTitle>Live, waiting for a trigger</PanelTitle>
        <Text size="xs" className="text-foreground-neutral-muted">
          These workflows are merged into <BranchName branch={defaultBranch} />. Each one runs when
          its trigger fires.
        </Text>
      </PanelHeader>
      <PanelBody>
        <ul className="divide-y divide-border-neutral-base">
          {definitions.map((definition) => (
            <li key={definition.id} className="flex items-center gap-inline px-row py-row">
              <div className="flex min-w-0 flex-1 flex-col gap-tight">
                <Text size="sm" bold className="truncate">
                  {definition.name}
                </Text>
                <Code className="truncate text-foreground-neutral-muted">
                  {definition.configPath ?? 'Manual definition'}
                </Code>
              </div>
              <WaitsFor definition={definition} />
              {definition.manualTrigger ? (
                <PanelActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    isLoading={runningDefinitionId === definition.id}
                    onClick={() => onRun(definition)}
                  >
                    Run now
                  </Button>
                </PanelActions>
              ) : null}
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}

function WaitsFor({definition}: {definition: Definition}) {
  const triggers = triggerLabels(definition);
  if (triggers.length === 0) return null;
  return (
    <div className="hidden min-w-0 items-center gap-tight md:flex">
      <Text size="xs" className="shrink-0 text-foreground-neutral-muted">
        Waits for
      </Text>
      {triggers.map((label) => (
        <Code key={label} className="truncate">
          {label}
        </Code>
      ))}
    </div>
  );
}

function BranchName({branch}: {branch: string | null}) {
  if (!branch) return <>the default branch</>;
  return (
    <Code as="code" variant="label">
      {branch}
    </Code>
  );
}

function triggerLabels(definition: Definition): string[] {
  const model = definition.workflowModel as {triggers?: {source: string; event?: string}[]} | null;
  // The manual trigger has its own Run now button.
  return (model?.triggers ?? [])
    .filter((trigger) => trigger.source !== 'manual')
    .map((trigger) => (trigger.event ? `${trigger.source} ${trigger.event}` : trigger.source));
}

// No workflow files is how every project starts; the first-workflow panel covers it.
function syncErrorMessage(sync: DefinitionSyncSummary | null): string | null {
  if (sync?.status !== 'failed' || sync.lastErrorCode === 'no-workflow-files') return null;
  return sync.lastErrorMessage ?? 'The last sync failed.';
}
