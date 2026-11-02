import {ApiError} from '@shipfox/client-api';
import {
  type Definition,
  type DefinitionSyncDiagnostic,
  type DefinitionSyncSummary,
  SourceStrip,
  useDefinitionsInfiniteQuery,
  useProjectQuery,
} from '@shipfox/client-projects';
import {parseWorkspaceParams, useChrome, useRouteParams} from '@shipfox/client-shell/runtime';
import {QueryLoadError} from '@shipfox/client-ui';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shipfox/react-ui/sheet';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {type ReactNode, useEffect, useRef, useState} from 'react';
import {DefinitionPackagesPanel} from '#components/definition-packages-panel/definition-packages-panel.js';
import {
  WorkflowDefinitionsTable,
  type WorkflowRunError,
} from '#components/workflow-definitions-table.js';
import {runStartErrorCopy} from '#core/run-issue-copy.js';
import {usePackageUpdatesQuery} from '#hooks/api/package-updates.js';
import {useInvalidateRunReadiness, useRunReadinessQuery} from '#hooks/api/run-readiness.js';
import {useFireManualWorkflowMutation} from '#hooks/api/workflow-runs.js';

export function ProjectWorkflowsPage({projectId}: {projectId: string}) {
  return (
    <RelativeTimeProvider>
      <ProjectWorkflowsPageInner projectId={projectId} />
    </RelativeTimeProvider>
  );
}

function ProjectWorkflowsPageInner({projectId}: {projectId: string}) {
  const projectQuery = useProjectQuery(projectId);
  const definitionsQuery = useDefinitionsInfiniteQuery(projectId);
  const fireManual = useFireManualWorkflowMutation();
  const invalidateReadiness = useInvalidateRunReadiness(projectId);
  const [selectedDefinition, setSelectedDefinition] = useState<Definition | null>(null);
  const {workspaceSlug} = useRouteParams(parseWorkspaceParams);
  const [runError, setRunError] = useState<WorkflowRunError | null>(null);
  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const sync = definitionsQuery.data?.pages[0]?.sync;
  const readiness = useRunReadinessQuery(
    projectId,
    // Placeholder pages belong to the previous project, so they have no readiness here.
    definitionsQuery.isPlaceholderData
      ? []
      : (definitionsQuery.data?.pages.map((page) => page.definitions.map(({id}) => id)) ?? []),
  );
  useInvalidateOnSyncComplete(invalidateReadiness, sync?.status);

  async function handleRun(definition: Definition) {
    setRunError(null);
    if (!definition.manualTrigger) return;
    try {
      await fireManual.mutateAsync({projectId, definitionId: definition.id});
      toast.success('Run queued');
    } catch (error) {
      setRunError({definitionId: definition.id, copy: runStartErrorCopy(error)});
      void invalidateReadiness();
    }
  }

  let projectErrorContent: ReactNode = null;
  if (projectQuery.isError && projectQuery.data === undefined) {
    projectErrorContent =
      projectQuery.error instanceof ApiError && projectQuery.error.status === 404 ? (
        <EmptyState
          icon="errorWarningLine"
          title="Project not found"
          description="This project doesn't exist, or you don't have access to it."
        />
      ) : (
        <QueryLoadError query={projectQuery} subject="project" />
      );
  }

  return (
    <div className="min-h-0 w-full flex-1 overflow-y-auto">
      <div className="flex flex-col gap-section">
        <Header variant="h1" className="sr-only">
          Workflows
        </Header>

        {projectQuery.isPending ? (
          <div className="flex flex-col gap-cluster">
            <Skeleton className="h-28 w-1/3" />
            <Skeleton className="h-18 w-1/2" />
          </div>
        ) : null}

        {projectErrorContent}

        {projectQuery.data ? (
          <>
            <SourceStrip
              connectionId={projectQuery.data.source.connectionId}
              externalRepositoryId={projectQuery.data.source.externalRepositoryId}
              sync={sync}
              isPending={definitionsQuery.isPending}
            />

            <WorkflowSyncAlert sync={sync} hasDefinitions={definitions.length > 0} />
            <WorkflowSyncDiagnostics sync={sync} />

            <FirstWorkflowSlot
              projectId={projectId}
              definitionsLoaded={definitionsQuery.isSuccess && !definitionsQuery.isPlaceholderData}
              definitionCount={definitions.length}
              sync={sync}
            >
              <WorkflowDefinitionsTable
                definitions={definitions}
                isPending={definitionsQuery.isPending}
                isError={definitionsQuery.isError}
                isRefreshing={definitionsQuery.isRefetching}
                sync={sync ?? null}
                runError={runError}
                runningDefinitionId={
                  fireManual.isPending && fireManual.variables
                    ? fireManual.variables.definitionId
                    : null
                }
                hasNextPage={definitionsQuery.hasNextPage}
                isFetchingNextPage={definitionsQuery.isFetchingNextPage}
                isFetchNextPageError={definitionsQuery.isFetchNextPageError}
                onRetry={() => definitionsQuery.refetch()}
                onLoadMore={() => definitionsQuery.fetchNextPage()}
                onOpenDefinition={setSelectedDefinition}
                readiness={readiness}
                onRun={(definition) => {
                  void handleRun(definition);
                }}
                onDismissRunError={() => setRunError(null)}
                onRefreshDefinitions={() => {
                  setRunError(null);
                  void definitionsQuery.refetch();
                }}
                workspaceSlug={workspaceSlug}
              />
            </FirstWorkflowSlot>
          </>
        ) : null}

        <DefinitionSheet
          workspaceId={projectQuery.data?.workspaceId}
          definition={selectedDefinition}
          onOpenChange={(open) => {
            if (!open) setSelectedDefinition(null);
          }}
        />
      </div>
    </div>
  );
}

/** A finished sync may have changed what the definitions need. */
function useInvalidateOnSyncComplete(
  invalidate: () => unknown,
  status: DefinitionSyncSummary['status'] | undefined,
) {
  const previousStatus = useRef(status);
  useEffect(() => {
    const wasRunning = previousStatus.current === 'pending' || previousStatus.current === 'syncing';
    previousStatus.current = status;
    if (wasRunning && (status === 'succeeded' || status === 'failed')) void invalidate();
  }, [invalidate, status]);
}

/**
 * Replaces the definitions table with the first workflow panel once the page
 * knows the project has none and no sync in progress is about to find one.
 */
function FirstWorkflowSlot({
  projectId,
  definitionsLoaded,
  definitionCount,
  sync,
  children,
}: {
  projectId: string;
  definitionsLoaded: boolean;
  definitionCount: number;
  sync: DefinitionSyncSummary | null | undefined;
  children: ReactNode;
}) {
  const {FirstWorkflowPanel} = useChrome();
  const syncInProgress = sync?.status === 'pending' || sync?.status === 'syncing';
  if (!FirstWorkflowPanel || !definitionsLoaded || definitionCount > 0 || syncInProgress) {
    return children;
  }
  return <FirstWorkflowPanel projectId={projectId} />;
}

function WorkflowSyncAlert({
  sync,
  hasDefinitions,
}: {
  sync: DefinitionSyncSummary | null | undefined;
  hasDefinitions: boolean;
}) {
  if (sync?.status !== 'failed') return null;
  // A repository without workflow files is where every project starts, and the
  // empty state already says so. With definitions still listed, the files were
  // removed and the failed sync kept the old rows, so the callout explains them.
  if (sync.lastErrorCode === 'no-workflow-files' && !hasDefinitions) return null;

  return (
    <Callout role="alert" type="error">
      <div className="flex flex-col gap-tight">
        <Text size="sm" bold>
          Workflow sync failed
        </Text>
        <Text size="sm">
          {sync.lastErrorMessage ?? 'The latest workflow sync failed before definitions updated.'}
        </Text>
      </div>
    </Callout>
  );
}

function WorkflowSyncDiagnostics({sync}: {sync: DefinitionSyncSummary | null | undefined}) {
  if (
    (sync?.status !== 'succeeded' && sync?.status !== 'failed') ||
    sync.diagnostics.length === 0
  ) {
    return null;
  }

  const hasErrors = sync.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const hasWarnings = sync.diagnostics.some((diagnostic) => diagnostic.severity === 'warning');
  const groups = groupDiagnosticsByFilePath(sync.diagnostics);
  let title = 'Workflow definition warnings';
  if (hasErrors && hasWarnings) title = 'Workflow definition diagnostics';
  else if (hasErrors) title = 'Workflow definition errors';

  return (
    <Callout role="status" type={hasErrors ? 'error' : 'warning'}>
      <div className="flex min-w-0 flex-1 flex-col gap-inline">
        <Text size="sm" bold>
          {title}
        </Text>
        <ul className="flex flex-col gap-tight">
          {groups.map((group) => (
            <li key={group.key} className="flex flex-col gap-tight">
              {group.filePath ? (
                <Code className="break-all text-foreground-neutral-muted">{group.filePath}</Code>
              ) : null}
              <ul className="flex flex-col gap-tight">
                {group.items.map(({key, diagnostic}) => {
                  const severityLabel = diagnostic.severity === 'error' ? 'Error' : 'Warning';

                  return (
                    <li key={key}>
                      {diagnostic.path ? (
                        <Code className="break-all text-foreground-neutral-muted">
                          {diagnostic.path}
                        </Code>
                      ) : null}
                      <Text size="sm">
                        <span className="font-medium">{severityLabel}:</span>{' '}
                        <span
                          className={
                            diagnostic.severity === 'error' ? 'text-tag-error-text' : undefined
                          }
                        >
                          {diagnostic.message}
                        </span>
                      </Text>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Callout>
  );
}

interface DiagnosticGroup {
  key: string;
  filePath: string | undefined;
  items: {key: string; diagnostic: DefinitionSyncDiagnostic}[];
}

function groupDiagnosticsByFilePath(
  diagnostics: readonly DefinitionSyncDiagnostic[],
): DiagnosticGroup[] {
  const groups: DiagnosticGroup[] = [];
  const indexByFilePath = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const filePathKey = diagnostic.filePath ?? '';
    const groupIndex = indexByFilePath.get(filePathKey);
    if (groupIndex === undefined) {
      indexByFilePath.set(filePathKey, groups.length);
      groups.push({
        key: `${filePathKey}-${groups.length}`,
        filePath: diagnostic.filePath,
        items: [{key: `${filePathKey}-0`, diagnostic}],
      });
    } else {
      const group = groups[groupIndex];
      if (group) group.items.push({key: `${filePathKey}-${group.items.length}`, diagnostic});
    }
  }
  return groups;
}

function DefinitionSheet({
  workspaceId,
  definition,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  definition: Definition | null;
  onOpenChange: (open: boolean) => void;
}) {
  const normalizedJson = definition
    ? JSON.stringify(
        {
          workflow_document: definition.workflowDocument,
          workflow_model: definition.workflowModel,
        },
        null,
        2,
      )
    : '';

  return (
    <Sheet open={Boolean(definition)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px]">
        {definition ? (
          <>
            <SheetHeader>
              <SheetTitle>{definition.name}</SheetTitle>
              <SheetDescription>
                {definition.configPath ?? 'Manual workflow definition'}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="gap-group">
              <div className="grid w-full gap-inline">
                <Metadata label="Definition id" value={definition.id} />
                <Metadata label="Source" value={definition.source} />
                <Metadata label="Ref" value={definition.ref ?? 'Not set'} />
                <Metadata label="SHA" value={definition.sha ?? 'Not set'} />
              </div>
              {workspaceId ? (
                <DefinitionPackages workspaceId={workspaceId} definitionId={definition.id} />
              ) : null}
              <div className="flex w-full flex-col gap-inline">
                <Text size="sm" bold>
                  Normalized definition
                </Text>
                <pre className="max-h-[52vh] w-full overflow-auto rounded-8 border border-border-neutral-base bg-background-neutral-subtle p-panel-compact scrollbar">
                  <Code as="code" className="whitespace-pre text-foreground-neutral-base">
                    {normalizedJson}
                  </Code>
                </pre>
              </div>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The notice is informational: it stays hidden until the first load succeeds, and a refetch keeps
 * the last answer on screen, even when the refetch fails.
 */
function DefinitionPackages({
  workspaceId,
  definitionId,
}: {
  workspaceId: string;
  definitionId: string;
}) {
  const packageUpdatesQuery = usePackageUpdatesQuery(workspaceId, definitionId);
  return <DefinitionPackagesPanel updates={packageUpdatesQuery.data ?? []} />;
}

function Metadata({label, value}: {label: string; value: string}) {
  return (
    <div className="min-w-0 py-row first:pt-0 last:pb-0">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Text size="sm" className="break-words">
        {value}
      </Text>
    </div>
  );
}
