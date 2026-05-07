import type {DefinitionDto, DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import {ApiError} from '@shipfox/client-api';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Code,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusBadge,
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
import {useDefinitionsQuery} from '#hooks/api/definitions.js';
import {useProjectQuery} from '#hooks/api/projects.js';
import {useCreateWorkflowRunMutation} from '#hooks/api/workflow-runs.js';
import {projectErrorCopy} from '#project-error.js';

export function ProjectDetailPage({projectId}: {projectId: string}) {
  const projectQuery = useProjectQuery(projectId);
  const definitionsQuery = useDefinitionsQuery(projectId);
  const createRun = useCreateWorkflowRunMutation();
  const [selectedDefinition, setSelectedDefinition] = useState<DefinitionDto | null>(null);
  const [runError, setRunError] = useState<{definitionId: string; message: string} | null>(null);
  const errorCopy = projectQuery.error ? projectErrorCopy(projectQuery.error) : undefined;

  async function handleRun(definition: DefinitionDto) {
    setRunError(null);
    try {
      await createRun.mutateAsync({project_id: projectId, definition_id: definition.id});
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
        <Card className="p-24">
          <Skeleton className="h-28 w-1/3" />
          <Skeleton className="h-18 w-1/2" />
        </Card>
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
        <section className="grid gap-18 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="p-20">
            <div className="flex flex-col gap-14 sm:flex-row sm:items-start sm:justify-between">
              <CardHeader>
                <CardTitle variant="h2">Workflows</CardTitle>
                <CardDescription>
                  Synced workflow definitions for this project source.
                </CardDescription>
              </CardHeader>
              <SyncBadge
                sync={definitionsQuery.data?.sync}
                isPending={definitionsQuery.isPending}
              />
            </div>
            <CardContent className="flex flex-col gap-14">
              <WorkflowSyncAlert sync={definitionsQuery.data?.sync} />
              <WorkflowDefinitionsList
                definitions={definitionsQuery.data?.definitions ?? []}
                isPending={definitionsQuery.isPending}
                isError={definitionsQuery.isError}
                sync={definitionsQuery.data?.sync ?? null}
                runError={runError}
                onRetry={() => definitionsQuery.refetch()}
                onOpenDefinition={setSelectedDefinition}
                onRun={(definition) => {
                  void handleRun(definition);
                }}
              />
            </CardContent>
          </Card>

          <Card className="p-20">
            <CardHeader>
              <CardTitle variant="h3">Source identity</CardTitle>
              <CardDescription>Source-control binding for this project.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border-neutral-base">
              <Metadata label="Connection id" value={projectQuery.data.source.connection_id} />
              <Metadata
                label="External repository id"
                value={projectQuery.data.source.external_repository_id}
              />
            </CardContent>
          </Card>
        </section>
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

function WorkflowDefinitionsList({
  definitions,
  isPending,
  isError,
  sync,
  runError,
  onRetry,
  onOpenDefinition,
  onRun,
}: {
  definitions: DefinitionDto[];
  isPending: boolean;
  isError: boolean;
  sync: DefinitionSyncSummaryDto | null;
  runError: {definitionId: string; message: string} | null;
  onRetry: () => void;
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

  if (isError) {
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
              <TableHead>Workflow</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-180">Updated</TableHead>
              <TableHead className="w-144 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {definitions.map((definition) => {
              const runErrorMessage =
                runError?.definitionId === definition.id ? runError.message : null;

              return (
                <TableRow
                  key={definition.id}
                  className="cursor-pointer"
                  onClick={() => onOpenDefinition(definition)}
                >
                  <TableCell className="max-w-260">
                    <div className="flex min-w-0 flex-col gap-2">
                      <Text size="sm" bold className="truncate">
                        {definition.name}
                      </Text>
                      {runErrorMessage ? (
                        <Text size="xs" className="text-tag-error-text">
                          {runErrorMessage}
                        </Text>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-320">
                    <Code className="truncate text-foreground-neutral-muted">
                      {definition.config_path ?? 'Manual definition'}
                    </Code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge variant={definition.source === 'vcs' ? 'info' : 'neutral'}>
                      {definition.source}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-foreground-neutral-muted">
                    {formatTimestamp(definition.updated_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-6">
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenDefinition(definition);
                        }}
                      >
                        Details
                      </Button>
                      <Button
                        size="xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRun(definition);
                        }}
                      >
                        Run
                      </Button>
                    </div>
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

          return (
            <div
              key={definition.id}
              className="flex flex-col gap-10 border-b border-border-neutral-base p-12 last:border-b-0"
            >
              <button
                type="button"
                className="flex min-w-0 flex-col gap-4 text-left"
                onClick={() => onOpenDefinition(definition)}
              >
                <Text size="sm" bold className="break-words">
                  {definition.name}
                </Text>
                <Code className="break-words text-foreground-neutral-muted">
                  {definition.config_path ?? 'Manual definition'}
                </Code>
              </button>
              <div className="flex flex-wrap items-center gap-8">
                <StatusBadge variant={definition.source === 'vcs' ? 'info' : 'neutral'}>
                  {definition.source}
                </StatusBadge>
                <Text size="xs" className="text-foreground-neutral-muted">
                  Updated {formatTimestamp(definition.updated_at)}
                </Text>
              </div>
              {runErrorMessage ? (
                <Text size="xs" className="text-tag-error-text">
                  {runErrorMessage}
                </Text>
              ) : null}
              <div className="flex gap-8">
                <Button size="sm" variant="secondary" onClick={() => onOpenDefinition(definition)}>
                  Details
                </Button>
                <Button size="sm" onClick={() => onRun(definition)}>
                  Run
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
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

function SyncBadge({
  sync,
  isPending,
}: {
  sync: DefinitionSyncSummaryDto | null | undefined;
  isPending: boolean;
}) {
  if (isPending) {
    return <StatusBadge variant="neutral">Loading</StatusBadge>;
  }
  if (sync === undefined) {
    return <StatusBadge variant="neutral">Unavailable</StatusBadge>;
  }
  if (sync === null) {
    return <StatusBadge variant="neutral">No sync</StatusBadge>;
  }

  const variantByStatus = {
    pending: 'neutral',
    syncing: 'info',
    succeeded: 'success',
    failed: 'error',
  } as const;

  return (
    <StatusBadge variant={variantByStatus[sync.status as keyof typeof variantByStatus]}>
      {sync.status}
    </StatusBadge>
  );
}

function DefinitionSheet({
  definition,
  onOpenChange,
}: {
  definition: DefinitionDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const normalizedJson = definition ? JSON.stringify(definition.definition, null, 2) : '';

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
                <Metadata label="Fetched at" value={formatTimestamp(definition.fetched_at)} />
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

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
