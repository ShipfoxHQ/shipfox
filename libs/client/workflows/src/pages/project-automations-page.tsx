import {ApiError} from '@shipfox/client-api';
import {
  configMoveErrorCopy,
  type Definition,
  type DefinitionSyncDiagnostic,
  type DefinitionSyncSummary,
  type ProjectConfig,
  useDefinitionsInfiniteQuery,
  useMoveProjectConfigMutation,
  useOpenProjectConfigPullRequestMutation,
  useProjectConfigQuery,
  useProjectQuery,
} from '@shipfox/client-projects';
import {useChrome} from '@shipfox/client-shell/runtime';
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
import {Link} from '@tanstack/react-router';
import {type ReactNode, useEffect, useState} from 'react';
import {ConfigFileLink, type ConfigFileView} from '#components/automations/config-file-link.js';
import {ConfigFilesTab} from '#components/automations/config-files-tab.js';
import {
  ConfigSourceHeader,
  type ConfigSourceHeaderActionError,
} from '#components/automations/config-source-header.js';
import {MoveToRepositoryDialog} from '#components/automations/move-to-repository-dialog.js';
import {DefinitionPackagesPanel} from '#components/definition-packages-panel/definition-packages-panel.js';
import {
  WorkflowDefinitionsTable,
  type WorkflowRunError,
} from '#components/workflow-definitions-table.js';
import {configSourceState, isMovingConfig} from '#core/automations.js';
import {normalizeConfigPath} from '#core/config-files.js';
import {runStartErrorCopy} from '#core/run-issue-copy.js';
import {useLatestWorkflowRunsQuery} from '#hooks/api/latest-runs.js';
import {useMemberName} from '#hooks/api/member-name.js';
import {usePackageUpdatesQuery} from '#hooks/api/package-updates.js';
import {useFireManualWorkflowMutation} from '#hooks/api/workflow-runs.js';

export type AutomationsTab =
  | {kind: 'workflows'}
  | {kind: 'files'; path: string | null; view: ConfigFileView};

export interface ProjectAutomationsPageProps {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  tab?: AutomationsTab | undefined;
}

const WORKFLOWS_TAB: AutomationsTab = {kind: 'workflows'};

export function ProjectAutomationsPage(props: ProjectAutomationsPageProps) {
  return (
    <RelativeTimeProvider>
      {/* A new project starts with fresh search, selection, and no placeholder rows. */}
      <ProjectAutomationsPageInner key={props.projectId} {...props} />
    </RelativeTimeProvider>
  );
}

function ProjectAutomationsPageInner({
  projectId,
  workspaceSlug,
  projectSlug,
  tab = WORKFLOWS_TAB,
}: ProjectAutomationsPageProps) {
  const projectQuery = useProjectQuery(projectId);
  const configQuery = useProjectConfigQuery(projectId);
  const definitionsQuery = useDefinitionsInfiniteQuery(projectId);
  useLoadEveryDefinitionPage(definitionsQuery);
  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const sync = definitionsQuery.data?.pages[0]?.sync;

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
          Automations
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
            <ConfigSourceSection
              projectId={projectId}
              workspaceId={projectQuery.data.workspaceId}
              workspaceSlug={workspaceSlug}
              config={configQuery.data}
              isConfigPending={configQuery.isPending}
              sync={sync}
              isSyncPending={definitionsQuery.isPending}
            />

            {/* Sync fails on purpose while a move waits for its merge, so the move banner explains it. */}
            {configQuery.data && isConfigMoving(configQuery.data) ? null : (
              <WorkflowSyncAlert sync={sync} hasDefinitions={definitions.length > 0} />
            )}

            <div className="flex flex-col gap-group">
              <AutomationsTabs workspaceSlug={workspaceSlug} projectSlug={projectSlug} />
              {tab.kind === 'files' ? (
                <ConfigFilesTab
                  projectId={projectId}
                  workspaceSlug={workspaceSlug}
                  projectSlug={projectSlug}
                  config={configQuery.data}
                  isConfigPending={configQuery.isPending}
                  onRetryConfig={() => {
                    void configQuery.refetch();
                  }}
                  definitions={definitions}
                  path={tab.path}
                  view={tab.view}
                />
              ) : (
                <WorkflowsTab
                  projectId={projectId}
                  workspaceId={projectQuery.data.workspaceId}
                  workspaceSlug={workspaceSlug}
                  projectSlug={projectSlug}
                  definitionsQuery={definitionsQuery}
                  definitions={definitions}
                  sync={sync}
                />
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The source header, wired to the move dialog and to the actions its banners offer. */
function ConfigSourceSection({
  projectId,
  workspaceId,
  workspaceSlug,
  config,
  isConfigPending,
  sync,
  isSyncPending,
}: {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  config: ProjectConfig | undefined;
  isConfigPending: boolean;
  sync: DefinitionSyncSummary | null | undefined;
  isSyncPending: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const retryMove = useMoveProjectConfigMutation();
  const openPullRequest = useOpenProjectConfigPullRequestMutation();
  const [actionError, setActionError] = useState<ConfigSourceHeaderActionError | null>(null);
  const moverName = useMemberName(
    workspaceId,
    config?.move?.status === 'linking' ? config.move.startedBy : null,
  );

  let pendingAction: 'retry' | 'open-pull-request' | null = null;
  if (retryMove.isPending) pendingAction = 'retry';
  else if (openPullRequest.isPending) pendingAction = 'open-pull-request';

  return (
    <>
      <ConfigSourceHeader
        config={config}
        isConfigPending={isConfigPending}
        sync={sync}
        isSyncPending={isSyncPending}
        moverName={moverName}
        onMove={() => setDialogOpen(true)}
        onRetryMove={(target) => {
          setActionError(null);
          retryMove.mutate(
            {projectId, ...target},
            {
              onError: (error) =>
                setActionError(
                  configMoveErrorCopy(error, {repositoryName: config?.move?.target.fullName}),
                ),
            },
          );
        }}
        onOpenNewPullRequest={() => {
          setActionError(null);
          openPullRequest.mutate(
            {projectId},
            {
              onError: (error) =>
                setActionError(
                  configMoveErrorCopy(error, {repositoryName: sourceFullName(config)}),
                ),
            },
          );
        }}
        pendingAction={pendingAction}
        actionError={actionError}
      />
      {/* Stays mounted through the move, after which the source is no longer managed. */}
      {config?.source.kind === 'managed' || dialogOpen ? (
        <MoveToRepositoryDialog
          projectId={projectId}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </>
  );
}

function sourceFullName(config: ProjectConfig | undefined): string | null {
  const {owner, name} = config?.source ?? {};
  return owner && name ? `${owner}/${name}` : null;
}

function isConfigMoving(config: ProjectConfig): boolean {
  return isMovingConfig(configSourceState(config, Date.now()));
}

function WorkflowsTab({
  projectId,
  workspaceId,
  workspaceSlug,
  projectSlug,
  definitionsQuery,
  definitions,
  sync,
}: {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  projectSlug: string;
  definitionsQuery: ReturnType<typeof useDefinitionsInfiniteQuery>;
  definitions: Definition[];
  sync: DefinitionSyncSummary | null | undefined;
}) {
  const latestRuns = useLatestWorkflowRunsQuery(
    projectId,
    definitionsQuery.data?.pages.map((page) =>
      page.definitions.map((definition) => definition.id),
    ) ?? [],
  );
  const fireManual = useFireManualWorkflowMutation();
  const [selectedDefinition, setSelectedDefinition] = useState<Definition | null>(null);
  const [runError, setRunError] = useState<WorkflowRunError | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  async function handleRun(definition: Definition) {
    setRunError(null);
    if (!definition.manualTrigger) return;
    try {
      await fireManual.mutateAsync({projectId, definitionId: definition.id});
      toast.success('Run queued');
    } catch (error) {
      setRunError({definitionId: definition.id, copy: runStartErrorCopy(error)});
    }
  }

  return (
    <>
      <WorkflowSyncDiagnostics
        sync={sync}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
      />

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
          latestRuns={latestRuns}
          runError={runError}
          runningDefinitionId={
            fireManual.isPending && fireManual.variables ? fireManual.variables.definitionId : null
          }
          hasNextPage={definitionsQuery.hasNextPage}
          isFetchingNextPage={definitionsQuery.isFetchingNextPage}
          isFetchNextPageError={definitionsQuery.isFetchNextPageError}
          onRetry={() => definitionsQuery.refetch()}
          onLoadMore={() => definitionsQuery.fetchNextPage()}
          onOpenDefinition={setSelectedDefinition}
          onRun={(definition) => {
            void handleRun(definition);
          }}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onDismissRunError={() => setRunError(null)}
          onRefreshDefinitions={() => {
            setRunError(null);
            void definitionsQuery.refetch();
          }}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
        />
      </FirstWorkflowSlot>

      <DefinitionSheet
        workspaceId={workspaceId}
        definition={selectedDefinition}
        onOpenChange={(open) => {
          if (!open) setSelectedDefinition(null);
        }}
      />
    </>
  );
}

/**
 * Search runs over the whole project, so the page keeps reading pages until none remain. A
 * failed page stops the walk, and the table's footer offers the retry.
 */
function useLoadEveryDefinitionPage(
  definitionsQuery: ReturnType<typeof useDefinitionsInfiniteQuery>,
) {
  const {hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage} = definitionsQuery;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError]);
}

const AUTOMATIONS_TAB_CLASS_NAME =
  'inline-flex h-40 items-center border-b-2 text-sm font-medium outline-none transition-colors focus-visible:shadow-border-interactive-with-active';

function AutomationsTabs({
  workspaceSlug,
  projectSlug,
}: {
  workspaceSlug: string;
  projectSlug: string;
}) {
  const activeProps = {
    className: 'border-border-highlights-interactive text-foreground-neutral-base',
  };
  const inactiveProps = {
    className:
      'border-transparent text-foreground-neutral-subtle hover:text-foreground-neutral-base',
  };
  return (
    <nav
      aria-label="Automations"
      className="flex items-end gap-cluster border-b border-border-neutral-base"
    >
      <Link
        to="/w/$workspaceSlug/p/$projectSlug/automations"
        params={{workspaceSlug, projectSlug}}
        activeOptions={{exact: true}}
        activeProps={activeProps}
        inactiveProps={inactiveProps}
        className={AUTOMATIONS_TAB_CLASS_NAME}
      >
        Workflows
      </Link>
      <Link
        to="/w/$workspaceSlug/p/$projectSlug/automations/files/$"
        params={{workspaceSlug, projectSlug, _splat: ''} as never}
        activeProps={activeProps}
        inactiveProps={inactiveProps}
        className={AUTOMATIONS_TAB_CLASS_NAME}
      >
        Files
      </Link>
    </nav>
  );
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

function WorkflowSyncDiagnostics({
  sync,
  workspaceSlug,
  projectSlug,
}: {
  sync: DefinitionSyncSummary | null | undefined;
  workspaceSlug: string;
  projectSlug: string;
}) {
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
                <DiagnosticFilePath
                  filePath={group.filePath}
                  workspaceSlug={workspaceSlug}
                  projectSlug={projectSlug}
                />
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

/** Only paths under `.shipfox` open on the Files tab. */
function DiagnosticFilePath({
  filePath,
  workspaceSlug,
  projectSlug,
}: {
  filePath: string;
  workspaceSlug: string;
  projectSlug: string;
}) {
  const code = <Code className="break-all text-foreground-neutral-muted">{filePath}</Code>;
  if (!normalizeConfigPath(filePath)) return code;
  return (
    <ConfigFileLink
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      path={filePath}
      className="w-fit rounded-4 outline-none hover:underline focus-visible:shadow-border-interactive-with-active"
    >
      {code}
    </ConfigFileLink>
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
