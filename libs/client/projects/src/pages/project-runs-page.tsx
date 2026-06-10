import type {FoxlangRunRecordDto} from '@shipfox/api-local-workflows-dto';
import {ApiError} from '@shipfox/client-api';
import {Alert, Button, Code, Header, Skeleton, Text, toast} from '@shipfox/react-ui';
import {Link, useParams} from '@tanstack/react-router';
import {StatusDot, type StatusDotVariant} from '#components/status-dot.js';
import {
  useLocalWorkflowRunsQuery,
  useLocalWorkflowStatusQuery,
  useTriggerLocalWorkflowFakeAlertMutation,
} from '#hooks/api/local-workflows.js';

export function ProjectRunsPage({projectId}: {projectId: string}) {
  const params = useParams({strict: false}) as {wid?: string};
  const statusQuery = useLocalWorkflowStatusQuery(projectId);
  const runsQuery = useLocalWorkflowRunsQuery(projectId);
  const triggerFakeAlert = useTriggerLocalWorkflowFakeAlertMutation(projectId);
  const runs = runsQuery.data?.runs ?? [];

  async function handleTriggerFakeAlert() {
    const id = `alert-${Date.now()}`;
    try {
      const result = await triggerFakeAlert.mutateAsync({
        id,
        severity: 'critical',
        message: 'checkout conversion degraded',
      });
      toast.success(`Fake alert triggered: ${result.run_id}`);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not trigger fake alert.'));
    }
  }

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex items-start justify-between gap-16">
        <div className="flex min-w-0 flex-col gap-2">
          <Header variant="h2">Runs</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Local workflow runs persisted by the Foxlang V0 Local Service.
          </Text>
        </div>
        <Button
          size="sm"
          isLoading={triggerFakeAlert.isPending}
          onClick={() => {
            void handleTriggerFakeAlert();
          }}
        >
          Fake alert
        </Button>
      </header>

      {statusQuery.data && !statusQuery.data.reachable ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Local service unavailable
            </Text>
            <Text size="sm">{statusQuery.data.setup_hint}</Text>
          </div>
        </Alert>
      ) : null}

      {triggerFakeAlert.error ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Fake alert rejected
            </Text>
            <Text size="sm">
              {errorMessage(triggerFakeAlert.error, 'The local service rejected the fake alert.')}
            </Text>
          </div>
        </Alert>
      ) : null}

      {runsQuery.isPending ? <RunsSkeleton /> : null}

      {runsQuery.isError ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Runs unavailable
            </Text>
            <Text size="sm">Local workflow runs could not be loaded.</Text>
            <Button size="sm" variant="secondary" onClick={() => runsQuery.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {!runsQuery.isPending && !runsQuery.isError && runs.length === 0 ? (
        <div className="rounded-8 border border-border-neutral-base bg-background-neutral-subtle px-14 py-18">
          <Text size="sm" bold>
            No local runs yet
          </Text>
          <Text size="sm" className="mt-4 text-foreground-neutral-muted">
            Trigger a fake alert after registering the reference workflow directory.
          </Text>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="flex flex-col divide-y divide-border-neutral-base rounded-8 border border-border-neutral-base bg-background-neutral-base">
          {runs.map((run) => (
            <LocalRunRow
              key={run.run_id}
              run={run}
              workspaceId={params.wid ?? ''}
              projectId={projectId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RunsSkeleton() {
  return (
    <div className="flex flex-col rounded-8 border border-border-neutral-base">
      {Array.from({length: 3}).map((_, idx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton row, stable position
          key={idx}
          className="flex h-44 items-center gap-12 border-b border-border-neutral-base px-12 last:border-b-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-14 w-140" />
          <Skeleton className="h-14 flex-1" />
          <Skeleton className="h-14 w-100" />
        </div>
      ))}
    </div>
  );
}

function LocalRunRow({
  run,
  workspaceId,
  projectId,
}: {
  run: FoxlangRunRecordDto;
  workspaceId: string;
  projectId: string;
}) {
  const statusVariant = localWorkflowRunStatusVariant(run.status);
  return (
    <Link
      to="/workspaces/$wid/projects/$pid/runs/$runId"
      params={{wid: workspaceId, pid: projectId, runId: run.run_id}}
      className="flex flex-col gap-6 px-12 py-10 transition-colors hover:bg-background-components-hover md:h-44 md:flex-row md:items-center md:gap-12 md:py-0"
    >
      <div className="flex shrink-0 flex-col gap-2 md:w-180">
        <Code variant="label" className="truncate text-foreground-neutral-muted">
          {run.run_id}
        </Code>
        <Text size="xs" className="truncate text-foreground-neutral-muted">
          {run.provider_event_id ?? 'fake alert'}
        </Text>
      </div>

      <div className="flex shrink-0 items-center gap-6 md:w-130">
        <StatusDot variant={statusVariant} />
        <Text size="xs" className="text-foreground-neutral-muted">
          {run.status.replaceAll('_', ' ')}
        </Text>
      </div>

      <div className="min-w-0 flex-1">
        <Text size="sm" bold className="truncate">
          {run.workflow_name ?? run.workflow_id ?? 'Local workflow'}
        </Text>
      </div>

      <div className="shrink-0 md:w-160 md:text-right">
        <Code className="truncate text-foreground-neutral-muted">
          {run.trigger_name ?? run.trigger_id ?? '-'}
        </Code>
      </div>
    </Link>
  );
}

export function localWorkflowRunStatusVariant(status: string): StatusDotVariant {
  if (status === 'completed') return 'success';
  if (status === 'source_invalid' || status === 'input_rejected' || status === 'runner_failed') {
    return 'error';
  }
  return 'neutral';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
