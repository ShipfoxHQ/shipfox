import {ApiError} from '@shipfox/client-api';
import {
  type Definition,
  type DefinitionSyncDiagnostic,
  type DefinitionSyncSummary,
  SourceStrip,
  useDefinitionsInfiniteQuery,
  useProjectQuery,
} from '@shipfox/client-projects';
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
import {type ReactNode, useState} from 'react';
import {WorkflowDefinitionsTable} from '#components/workflow-definitions-table.js';
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
  const [selectedDefinition, setSelectedDefinition] = useState<Definition | null>(null);
  const [runError, setRunError] = useState<{definitionId: string; message: string} | null>(null);
  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const sync = definitionsQuery.data?.pages[0]?.sync;

  async function handleRun(definition: Definition) {
    setRunError(null);
    if (!definition.manualTrigger) return;
    try {
      await fireManual.mutateAsync({projectId, definitionId: definition.id});
      toast.success('Run queued');
    } catch (error) {
      const message = errorMessage(error, 'Could not queue run.');
      setRunError({definitionId: definition.id, message});
      toast.error(message);
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
    <div className="flex w-full flex-col gap-section">
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

          <WorkflowSyncAlert sync={sync} />
          <WorkflowSyncDiagnostics sync={sync} />

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
            onRun={(definition) => {
              void handleRun(definition);
            }}
          />
        </>
      ) : null}

      <DefinitionSheet
        definition={selectedDefinition}
        onOpenChange={(open) => {
          if (!open) setSelectedDefinition(null);
        }}
      />
    </div>
  );
}

function WorkflowSyncAlert({sync}: {sync: DefinitionSyncSummary | null | undefined}) {
  if (sync?.status !== 'failed') return null;

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
  definition,
  onOpenChange,
}: {
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

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
