import type {DefinitionDto, DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import {ApiError} from '@shipfox/client-api';
import {
  Alert,
  Button,
  Code,
  Header,
  Icon,
  type IconName,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useState} from 'react';
import {SourceStrip} from '#components/source-strip.js';
import {useDefinitionsInfiniteQuery} from '#hooks/api/definitions.js';
import {useProjectQuery} from '#hooks/api/projects.js';
import {useFireManualWorkflowMutation} from '#hooks/api/workflow-runs.js';
import {RelativeTime, RelativeTimeProvider} from '#lib/relative-time.js';
import {projectErrorCopy} from '#project-error.js';

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
  const [selectedDefinition, setSelectedDefinition] = useState<DefinitionDto | null>(null);
  const [runError, setRunError] = useState<{definitionId: string; message: string} | null>(null);
  const errorCopy = projectQuery.error ? projectErrorCopy(projectQuery.error) : undefined;
  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const sync = definitionsQuery.data?.pages[0]?.sync;

  async function handleRun(definition: DefinitionDto) {
    setRunError(null);
    if (!definition.manual_trigger) return;
    try {
      await fireManual.mutateAsync({projectId, definitionId: definition.id});
      toast.success('Run queued');
    } catch (error) {
      const message = errorMessage(error, 'Could not queue run.');
      setRunError({definitionId: definition.id, message});
      toast.error(message);
    }
  }

  return (
    <div className="flex w-full flex-col gap-24">
      {projectQuery.isPending ? (
        <div className="flex flex-col gap-12">
          <Skeleton className="h-28 w-1/3" />
          <Skeleton className="h-18 w-1/2" />
        </div>
      ) : null}

      {projectQuery.isError ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              {errorCopy?.title ?? 'Project unavailable'}
            </Text>
            <Text size="sm">
              {projectQuery.error &&
              'status' in projectQuery.error &&
              projectQuery.error.status === 404
                ? 'This project was not found.'
                : errorCopy?.message}
            </Text>
            <Button size="sm" variant="secondary" onClick={() => projectQuery.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {projectQuery.data ? (
        <>
          <header className="flex flex-col gap-4">
            <Header variant="h2">Workflows</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              Synced workflow definitions for this project source.
            </Text>
          </header>

          <SourceStrip
            connectionId={projectQuery.data.source.connection_id}
            externalRepositoryId={projectQuery.data.source.external_repository_id}
            sync={sync}
            isPending={definitionsQuery.isPending}
          />

          <WorkflowSyncAlert sync={sync} />

          <WorkflowDefinitionsList
            definitions={definitions}
            isPending={definitionsQuery.isPending}
            isError={definitionsQuery.isError}
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

function WorkflowDefinitionsList({
  definitions,
  isPending,
  isError,
  sync,
  runError,
  runningDefinitionId,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onRetry,
  onLoadMore,
  onOpenDefinition,
  onRun,
}: {
  definitions: DefinitionDto[];
  isPending: boolean;
  isError: boolean;
  sync: DefinitionSyncSummaryDto | null;
  runError: {definitionId: string; message: string} | null;
  runningDefinitionId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenDefinition: (definition: DefinitionDto) => void;
  onRun: (definition: DefinitionDto) => void;
}) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError && definitions.length === 0) {
    return (
      <Alert variant="error" animated={false}>
        <div className="flex flex-col gap-8">
          <Text size="sm" bold>
            Workflows unavailable
          </Text>
          <Text size="sm">Definitions could not be loaded. Source metadata remains visible.</Text>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  if (definitions.length === 0) {
    return <WorkflowEmptyState sync={sync} />;
  }

  return (
    <>
      <div className="hidden rounded-8 border border-border-neutral-base md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40"></TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead className="w-180">Updated</TableHead>
              <TableHead className="w-80 text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {definitions.map((definition) => {
              const runErrorMessage =
                runError?.definitionId === definition.id ? runError.message : null;
              const isRunning = runningDefinitionId === definition.id;

              return (
                // The workflow-name cell holds a `<button>` so the row is
                // keyboard-reachable (Tab focuses, Enter/Space activates
                // via native button semantics). The TableRow itself is no
                // longer clickable — a row-level onClick would be invisible
                // to keyboard users and require custom keydown handling.
                // The `group` class on the row still drives the Run button
                // reveal on hover or focus-within.
                <TableRow key={definition.id} className="group">
                  <TableCell>
                    <Icon
                      name={sourceIcon(definition.source)}
                      className="size-16 text-foreground-neutral-muted"
                      aria-hidden="true"
                    />
                  </TableCell>
                  <TableCell className="max-w-260">
                    <div className="flex min-w-0 flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenDefinition(definition)}
                        className="flex min-w-0 flex-col gap-2 text-left outline-none focus-visible:shadow-border-interactive-with-active rounded-4"
                      >
                        <Text size="sm" bold className="truncate">
                          {definition.name}
                        </Text>
                        <Code className="truncate text-foreground-neutral-muted">
                          {definition.config_path ?? 'Manual definition'}
                        </Code>
                      </button>
                      {runErrorMessage ? (
                        <Text size="xs" className="text-tag-error-text">
                          {runErrorMessage}
                        </Text>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-foreground-neutral-muted">
                    <RelativeTime value={definition.updated_at} />
                  </TableCell>
                  <TableCell>
                    {definition.manual_trigger ? (
                      <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <Button size="xs" isLoading={isRunning} onClick={() => onRun(definition)}>
                          Run
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col rounded-8 border border-border-neutral-base md:hidden">
        {definitions.map((definition) => {
          const runErrorMessage =
            runError?.definitionId === definition.id ? runError.message : null;
          const isRunning = runningDefinitionId === definition.id;

          return (
            <div
              key={definition.id}
              className="flex flex-col gap-10 border-b border-border-neutral-base p-12 last:border-b-0"
            >
              <button
                type="button"
                className="flex min-w-0 items-start gap-10 text-left"
                onClick={() => onOpenDefinition(definition)}
              >
                <Icon
                  name={sourceIcon(definition.source)}
                  className="size-16 shrink-0 text-foreground-neutral-muted"
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-col gap-4">
                  <Text size="sm" bold className="break-words">
                    {definition.name}
                  </Text>
                  <Code className="break-words text-foreground-neutral-muted">
                    {definition.config_path ?? 'Manual definition'}
                  </Code>
                </div>
              </button>
              <div className="flex items-center justify-between gap-8">
                <Text size="xs" className="text-foreground-neutral-muted">
                  Updated <RelativeTime value={definition.updated_at} />
                </Text>
                {definition.manual_trigger ? (
                  <Button size="sm" isLoading={isRunning} onClick={() => onRun(definition)}>
                    Run
                  </Button>
                ) : null}
              </div>
              {runErrorMessage ? (
                <Text size="xs" className="text-tag-error-text">
                  {runErrorMessage}
                </Text>
              ) : null}
            </div>
          );
        })}
      </div>

      {isFetchNextPageError ? (
        <Alert variant="error" animated={false}>
          <div className="flex items-center justify-between gap-12">
            <Text size="sm">Could not load more workflows.</Text>
            <Button size="sm" variant="secondary" onClick={onLoadMore}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {hasNextPage ? (
        <div className="flex justify-center">
          <Button size="sm" variant="secondary" isLoading={isFetchingNextPage} onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function sourceIcon(source: 'manual' | 'vcs'): IconName {
  return source === 'vcs' ? ('gitBranchLine' as IconName) : ('terminalLine' as IconName);
}

function WorkflowEmptyState({sync}: {sync: DefinitionSyncSummaryDto | null}) {
  const message =
    sync?.status === 'failed' && sync.last_error_code === 'no-workflow-files'
      ? 'No workflow files found under .shipfox/workflows/.'
      : sync?.status === 'failed'
        ? (sync.last_error_message ?? 'Workflow definitions could not be synced.')
        : sync?.status === 'syncing'
          ? 'Workflow definitions are being discovered.'
          : sync?.status === 'succeeded'
            ? 'No workflow definitions found.'
            : 'Workflow sync has not reported yet.';

  return (
    <div className="rounded-8 border border-border-neutral-base bg-background-neutral-subtle px-14 py-18">
      <Text size="sm" bold>
        No workflows
      </Text>
      <Text size="sm" className="mt-4 text-foreground-neutral-muted">
        {message}
      </Text>
    </div>
  );
}

function WorkflowSyncAlert({sync}: {sync: DefinitionSyncSummaryDto | null | undefined}) {
  if (sync?.status !== 'failed') return null;

  return (
    <Alert variant="error" animated={false}>
      <div className="flex flex-col gap-4">
        <Text size="sm" bold>
          Workflow sync failed
        </Text>
        <Text size="sm">
          {sync.last_error_message ?? 'The latest workflow sync failed before definitions updated.'}
        </Text>
      </div>
    </Alert>
  );
}

function DefinitionSheet({
  definition,
  onOpenChange,
}: {
  definition: DefinitionDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const normalizedJson = definition
    ? JSON.stringify(
        {
          workflow_document: definition.workflow_document,
          workflow_model: definition.workflow_model,
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
                {definition.config_path ?? 'Manual workflow definition'}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="gap-18">
              <div className="grid w-full gap-10">
                <Metadata label="Definition id" value={definition.id} />
                <Metadata label="Source" value={definition.source} />
                <Metadata label="Ref" value={definition.ref ?? 'Not set'} />
                <Metadata label="SHA" value={definition.sha ?? 'Not set'} />
              </div>
              <div className="flex w-full flex-col gap-8">
                <Text size="sm" bold>
                  Normalized definition
                </Text>
                <pre className="max-h-[52vh] w-full overflow-auto rounded-8 border border-border-neutral-base bg-background-neutral-subtle p-12 scrollbar">
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
    <div className="min-w-0 py-12 first:pt-0 last:pb-0">
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
