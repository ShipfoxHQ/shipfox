import type {FoxlangWorkflowDetailResponseDto} from '@shipfox/api-local-workflows-dto';
import {
  Alert,
  Button,
  Code,
  Header,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@shipfox/react-ui';
import {useState} from 'react';
import {
  useLocalWorkflowQuery,
  useLocalWorkflowStatusQuery,
  useLocalWorkflowsQuery,
} from '#hooks/api/local-workflows.js';

export function ProjectWorkflowsPage({projectId}: {projectId: string}) {
  const statusQuery = useLocalWorkflowStatusQuery(projectId);
  const workflowsQuery = useLocalWorkflowsQuery(projectId);
  const workflows = workflowsQuery.data?.workflows ?? [];
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const selectedWorkflow = selectedWorkflowId ?? workflowId(workflows[0]?.workflow) ?? undefined;
  const detailQuery = useLocalWorkflowQuery(projectId, selectedWorkflow);

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex flex-col gap-4">
        <Header variant="h2">Workflows</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Local workflows registered in the Foxlang V0 Local Service.
        </Text>
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

      {workflowsQuery.isPending ? <WorkflowSkeleton /> : null}

      {workflowsQuery.isError ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Workflows unavailable
            </Text>
            <Text size="sm">Registered workflows could not be loaded from the local service.</Text>
            <Button size="sm" variant="secondary" onClick={() => workflowsQuery.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {!workflowsQuery.isPending && !workflowsQuery.isError && workflows.length === 0 ? (
        <div className="rounded-8 border border-border-neutral-base bg-background-neutral-subtle px-14 py-18">
          <Text size="sm" bold>
            No local workflows registered
          </Text>
          <Text size="sm" className="mt-4 text-foreground-neutral-muted">
            Run the reference-lab registration command before using the fake alert flow.
          </Text>
        </div>
      ) : null}

      {workflows.length > 0 ? (
        <div className="grid gap-16 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <div className="rounded-8 border border-border-neutral-base bg-background-neutral-base">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="w-120">Module</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((item) => {
                  const id = workflowId(item.workflow);
                  const selected = id === selectedWorkflow;
                  return (
                    <TableRow
                      key={id ?? item.preparation_id}
                      className={selected ? 'bg-background-highlight-base' : undefined}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="flex max-w-full flex-col gap-2 rounded-4 text-left outline-none focus-visible:shadow-border-interactive-with-active"
                          onClick={() => {
                            if (id) setSelectedWorkflowId(id);
                          }}
                        >
                          <Text size="sm" bold className="truncate">
                            {workflowName(item.workflow)}
                          </Text>
                          <Code className="truncate text-foreground-neutral-muted">
                            {id ?? item.preparation_id}
                          </Code>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Code className="text-foreground-neutral-muted">
                          {stringField(item.workflow, 'module_id') ?? '-'}
                        </Code>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <WorkflowDetailPanel
            workflowId={selectedWorkflow ?? null}
            detail={detailQuery.data ?? null}
            isPending={detailQuery.isPending}
            isError={detailQuery.isError}
            onRetry={() => detailQuery.refetch()}
          />
        </div>
      ) : null}
    </div>
  );
}

function WorkflowSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function WorkflowDetailPanel({
  workflowId,
  detail,
  isPending,
  isError,
  onRetry,
}: {
  workflowId: string | null;
  detail: FoxlangWorkflowDetailResponseDto | null;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const [tab, setTab] = useState<'source' | 'iface'>('source');

  if (!workflowId) {
    return (
      <div className="rounded-8 border border-border-neutral-base bg-background-neutral-subtle px-14 py-18">
        <Text size="sm">Select a workflow to inspect its source.</Text>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="rounded-8 border border-border-neutral-base p-16">
        <Skeleton className="h-24 w-180" />
        <Skeleton className="mt-16 h-240 w-full" />
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <Alert variant="error" animated={false}>
        <div className="flex flex-col gap-8">
          <Text size="sm" bold>
            Workflow detail unavailable
          </Text>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  const sourceText = detail.source.source_text ?? '';
  const ifaceText = detail.iface_text ?? '';
  const activeText = tab === 'source' ? sourceText : ifaceText;

  return (
    <section className="min-w-0 rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <div className="flex flex-col gap-8 border-b border-border-neutral-base px-14 py-12">
        <div className="flex flex-col gap-2">
          <Text size="sm" bold>
            {workflowName(detail.workflow)}
          </Text>
          <Code className="truncate text-foreground-neutral-muted">{workflowId}</Code>
        </div>
        <div className="flex gap-6">
          <Button
            size="xs"
            variant={tab === 'source' ? 'primary' : 'secondary'}
            onClick={() => setTab('source')}
          >
            .fox
          </Button>
          <Button
            size="xs"
            variant={tab === 'iface' ? 'primary' : 'secondary'}
            onClick={() => setTab('iface')}
          >
            iface
          </Button>
        </div>
      </div>
      <pre className="max-h-[520px] overflow-auto p-14 font-code text-sm leading-20 text-foreground-neutral-base">
        {activeText || 'No source text returned by the local service.'}
      </pre>
    </section>
  );
}

function workflowId(workflow: unknown): string | null {
  return stringField(workflow, 'workflow_id');
}

function workflowName(workflow: unknown): string {
  return (
    stringField(workflow, 'name') ?? stringField(workflow, 'workflow_name') ?? 'Local workflow'
  );
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}
