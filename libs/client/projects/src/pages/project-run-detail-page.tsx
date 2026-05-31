import type {
  FoxlangActionRecordDto,
  FoxlangBridgeValueDto,
  FoxlangRunDetailResponseDto,
  FoxlangRunGraphDto,
} from '@shipfox/api-local-workflows-dto';
import {Alert, Button, Code, Input, Skeleton, Text} from '@shipfox/react-ui';
import {Link, useParams} from '@tanstack/react-router';
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {StatusDot, type StatusDotVariant} from '#components/status-dot.js';
import {useLocalWorkflowQuery, useLocalWorkflowRunQuery} from '#hooks/api/local-workflows.js';

type DetailTab = 'overview' | 'logs' | 'source';
type InspectorTarget = 'trigger' | 'action';
type SourceTab = 'source' | 'iface';
type ExecutionMode = 'fit' | 'manual';

interface ExecutionTransform {
  scale: number;
  x: number;
  y: number;
  mode: ExecutionMode;
  label: string;
}

const LINE_SPLIT_RE = /\r?\n/;
const EXECUTION_GRAPH_WIDTH = 760;
const EXECUTION_GRAPH_HEIGHT = 270;
const MIN_EXECUTION_SCALE = 0.25;
const MAX_EXECUTION_SCALE = 2.5;

const statusVariant: Record<string, StatusDotVariant> = {
  completed: 'success',
  source_invalid: 'error',
  input_rejected: 'error',
  runner_failed: 'error',
  succeeded: 'success',
  received: 'neutral',
};

const statusPillClassByVariant: Record<StatusDotVariant, string> = {
  neutral: 'border-tag-neutral-border bg-tag-neutral-bg text-tag-neutral-text',
  info: 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text',
  success: 'border-tag-success-border bg-tag-success-bg text-tag-success-text',
  warning: 'border-tag-warning-border bg-tag-warning-bg text-tag-warning-text',
  error: 'border-tag-error-border bg-tag-error-bg text-tag-error-text',
};

export function ProjectRunDetailPage({projectId, runId}: {projectId: string; runId: string}) {
  const params = useParams({strict: false}) as {wid?: string};
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [selectedTarget, setSelectedTarget] = useState<InspectorTarget>('action');
  const [sourceTab, setSourceTab] = useState<SourceTab>('source');
  const [logSearch, setLogSearch] = useState('');
  const [modalContent, setModalContent] = useState<{title: string; value: string} | null>(null);
  const runQuery = useLocalWorkflowRunQuery(projectId, runId);
  const detail = runQuery.data;
  const graph = detail?.run;
  const run = graph?.run;
  const workflowId = run?.workflow_id;
  const workflowQuery = useLocalWorkflowQuery(projectId, workflowId);

  const logGroups = useMemo(() => buildLogGroups(graph), [graph]);
  const filteredLogGroups = useMemo(
    () => filterLogGroups(logGroups, logSearch),
    [logGroups, logSearch],
  );

  return (
    <div className="flex w-full flex-col gap-16">
      <header className="sticky top-0 z-20 -mx-24 -mt-32 mb-16 flex h-40 flex-wrap items-center gap-6 border-b border-border-neutral-base bg-background-neutral-base px-24">
        <Button asChild size="md" variant="secondary" className="h-30 px-10">
          <Link
            to="/workspaces/$wid/projects/$pid/runs"
            params={{wid: params.wid ?? '', pid: projectId}}
          >
            Back to runs
          </Link>
        </Button>
        <nav className="flex flex-wrap items-center gap-6" aria-label="Run detail sections">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
            Overview
          </TabButton>
          <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')}>
            Logs
          </TabButton>
          <TabButton active={activeTab === 'source'} onClick={() => setActiveTab('source')}>
            Source code
          </TabButton>
        </nav>
      </header>

      {runQuery.isPending ? <RunDetailSkeleton /> : null}

      {runQuery.isError ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Run unavailable
            </Text>
            <Text size="sm">The local service could not return this run.</Text>
            <Button size="sm" variant="secondary" onClick={() => runQuery.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {detail && graph && run ? (
        <>
          <RunSummary detail={detail} graph={graph} />

          {activeTab === 'overview' ? (
            <OverviewTab
              detail={detail}
              graph={graph}
              selectedTarget={selectedTarget}
              onSelectTarget={setSelectedTarget}
              onOpenModal={setModalContent}
            />
          ) : null}

          {activeTab === 'logs' ? (
            <LogsTab
              runId={runId}
              status={detail.status}
              groups={filteredLogGroups}
              search={logSearch}
              onSearch={setLogSearch}
              onRefresh={() => runQuery.refetch()}
              selectedTarget={selectedTarget}
              onSelectTarget={setSelectedTarget}
            />
          ) : null}

          {activeTab === 'source' ? (
            <SourceTabPanel
              workflowId={workflowId}
              isPending={workflowQuery.isPending}
              isError={workflowQuery.isError}
              sourceText={workflowQuery.data?.source.source_text ?? ''}
              ifaceText={workflowQuery.data?.iface_text ?? ''}
              activeTab={sourceTab}
              onSelectTab={setSourceTab}
              onRetry={() => workflowQuery.refetch()}
            />
          ) : null}
        </>
      ) : null}

      {modalContent ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background-modal-overlay p-24"
          role="presentation"
        >
          <section
            className="max-h-[82vh] w-[min(760px,92vw)] overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-workflow-modal-title"
          >
            <div className="flex min-h-48 items-center justify-between gap-12 border-b border-border-neutral-base px-14 py-12">
              <Text id="local-workflow-modal-title" size="sm" bold>
                {modalContent.title}
              </Text>
              <Button size="sm" variant="secondary" onClick={() => setModalContent(null)}>
                Close
              </Button>
            </div>
            <div className="max-h-[calc(82vh-49px)] overflow-auto p-14">
              <pre className="overflow-auto rounded-6 border border-border-neutral-base bg-background-subtle-base p-10 font-code text-sm leading-20">
                {modalContent.value || '(empty)'}
              </pre>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function RunDetailSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <Skeleton className="h-76 w-full" />
      <Skeleton className="h-320 w-full" />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={[
        'h-30 rounded-6 border px-10 text-md text-foreground-neutral-muted transition-colors outline-none hover:bg-background-components-hover hover:text-foreground-neutral-base focus-visible:shadow-border-interactive-with-active',
        active
          ? 'border-border-highlights-interactive bg-background-highlight-base text-foreground-highlight-interactive'
          : 'border-transparent bg-transparent',
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RunSummary({
  detail,
  graph,
}: {
  detail: FoxlangRunDetailResponseDto;
  graph: FoxlangRunGraphDto;
}) {
  const run = graph.run;
  const actionCount = graph.actions.length;
  const succeededCount = graph.actions.filter((action) => action.status === 'succeeded').length;
  return (
    <section
      className="grid overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base md:grid-cols-4"
      aria-label="Run summary"
    >
      <SummaryItem label="Workflow">
        <Text size="md" bold className="truncate">
          {run.workflow_name ?? 'Local workflow'}
        </Text>
        <Code className="block truncate text-foreground-neutral-muted">
          {run.workflow_id ?? '-'}
        </Code>
      </SummaryItem>
      <SummaryItem label="Run">
        <StatusPill status={detail.status} />
        <Code className="mt-3 block truncate text-foreground-neutral-muted">{run.run_id}</Code>
      </SummaryItem>
      <SummaryItem label="Trigger">
        <Text size="md" bold className="truncate">
          {run.trigger_name ?? '-'}
        </Text>
        <Code className="block truncate text-foreground-neutral-muted">
          {run.provider_event_id ?? '-'}
        </Code>
      </SummaryItem>
      <SummaryItem label="Actions">
        <Text size="md" bold>
          {succeededCount} succeeded
        </Text>
        <Code className="block truncate text-foreground-neutral-muted">
          {actionCount} action record{actionCount === 1 ? '' : 's'} returned
        </Code>
      </SummaryItem>
    </section>
  );
}

function SummaryItem({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="min-w-0 border-b border-border-neutral-base px-12 py-10 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0">
      <Text size="xs" className="mb-4 block text-foreground-neutral-muted">
        {label}
      </Text>
      {children}
    </div>
  );
}

function OverviewTab({
  detail,
  graph,
  selectedTarget,
  onSelectTarget,
  onOpenModal,
}: {
  detail: FoxlangRunDetailResponseDto;
  graph: FoxlangRunGraphDto;
  selectedTarget: InspectorTarget;
  onSelectTarget: (target: InspectorTarget) => void;
  onOpenModal: (content: {title: string; value: string}) => void;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{pointerId: number; startX: number; startY: number} | null>(null);
  const [executionTransform, setExecutionTransform] = useState<ExecutionTransform>({
    scale: 1,
    x: 0,
    y: 0,
    mode: 'fit',
    label: 'fit',
  });

  const fitExecution = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0 || viewport.clientHeight === 0) return;
    const scale = Math.max(
      MIN_EXECUTION_SCALE,
      Math.min(
        (viewport.clientWidth - 24) / EXECUTION_GRAPH_WIDTH,
        (viewport.clientHeight - 24) / EXECUTION_GRAPH_HEIGHT,
        1,
      ),
    );
    setExecutionTransform({
      scale,
      x: Math.round((viewport.clientWidth - EXECUTION_GRAPH_WIDTH * scale) / 2),
      y: Math.round((viewport.clientHeight - EXECUTION_GRAPH_HEIGHT * scale) / 2),
      mode: 'fit',
      label: `fit ${Math.round(scale * 100)}%`,
    });
  }, []);

  const zoomExecution = useCallback((delta: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setExecutionTransform((current) => {
      const pointX = typeof clientX === 'number' ? clientX - rect.left : viewport.clientWidth / 2;
      const pointY = typeof clientY === 'number' ? clientY - rect.top : viewport.clientHeight / 2;
      const beforeX = (pointX - current.x) / current.scale;
      const beforeY = (pointY - current.y) / current.scale;
      const scale = Math.min(
        MAX_EXECUTION_SCALE,
        Math.max(MIN_EXECUTION_SCALE, current.scale + delta),
      );
      return {
        scale,
        x: Math.round(pointX - beforeX * scale),
        y: Math.round(pointY - beforeY * scale),
        mode: 'manual',
        label: `${Math.round(scale * 100)}%`,
      };
    });
  }, []);

  const resetExecution = useCallback(() => {
    setExecutionTransform({scale: 1, x: 24, y: 24, mode: 'manual', label: '100%'});
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest('[data-exec-node]')) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX - executionTransform.x,
        startY: event.clientY - executionTransform.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setExecutionTransform((current) => ({...current, mode: 'manual'}));
    },
    [executionTransform.x, executionTransform.y],
  );

  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setExecutionTransform((current) => ({
      ...current,
      x: event.clientX - drag.startX,
      y: event.clientY - drag.startY,
      label: `${Math.round(current.scale * 100)}%`,
    }));
  }, []);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
  }, []);

  useEffect(() => {
    fitExecution();
  }, [fitExecution]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function handleWheel(event: globalThis.WheelEvent) {
      event.preventDefault();
      zoomExecution(event.deltaY < 0 ? 0.1 : -0.1, event.clientX, event.clientY);
    }

    viewport.addEventListener('wheel', handleWheel, {passive: false});
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [zoomExecution]);

  useEffect(() => {
    function handleResize() {
      setExecutionTransform((current) => {
        if (current.mode !== 'fit') return current;
        window.requestAnimationFrame(fitExecution);
        return current;
      });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitExecution]);

  return (
    <section className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
        <div className="flex min-h-48 flex-wrap items-center justify-between gap-12 border-b border-border-neutral-base px-14 py-12">
          <div className="min-w-0">
            <Text size="lg" bold>
              Execution
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              Run detail for the selected workflow execution.
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <StatusPill status={detail.status} />
            <Button size="xs" variant="secondary" onClick={fitExecution}>
              Fit
            </Button>
            <Button
              size="xs"
              variant="secondary"
              aria-label="Zoom out"
              onClick={() => zoomExecution(-0.15)}
            >
              -
            </Button>
            <Button
              size="xs"
              variant="secondary"
              aria-label="Zoom in"
              onClick={() => zoomExecution(0.15)}
            >
              +
            </Button>
            <Button size="xs" variant="secondary" aria-label="Reset zoom" onClick={resetExecution}>
              100%
            </Button>
          </div>
        </div>
        <ExecutionGraph
          graph={graph}
          selectedTarget={selectedTarget}
          onSelectTarget={onSelectTarget}
          transform={executionTransform}
          viewportRef={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div className="flex justify-between gap-12 border-t border-border-neutral-base px-12 py-8 text-foreground-neutral-muted">
          <Code>{executionTransform.label}</Code>
          <Text size="xs">Drag to move. Use mouse wheel to zoom.</Text>
        </div>
      </div>

      <InspectorPanel graph={graph} selectedTarget={selectedTarget} onOpenModal={onOpenModal} />
    </section>
  );
}

function ExecutionGraph({
  graph,
  selectedTarget,
  onSelectTarget,
  transform,
  viewportRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  graph: FoxlangRunGraphDto;
  selectedTarget: InspectorTarget;
  onSelectTarget: (target: InspectorTarget) => void;
  transform: ExecutionTransform;
  viewportRef: RefObject<HTMLElement | null>;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
}) {
  const run = graph.run;
  const action = graph.actions[0];
  const triggerSource = [
    stringField(graph.trigger_evidence, 'source_alias'),
    stringField(graph.trigger_evidence, 'source_event'),
  ]
    .filter(Boolean)
    .join('.');
  return (
    <section
      ref={viewportRef}
      className="relative h-270 overflow-hidden bg-background-subtle-base"
      aria-label="Execution graph"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-alpha-black-8) 1px, transparent 1px), linear-gradient(90deg, var(--color-alpha-black-8) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div
        className="absolute left-0 top-0 h-270 w-[760px] origin-top-left"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        <div className="absolute left-30 top-76 h-104 w-250">
          <GraphNode
            selected={selectedTarget === 'trigger'}
            tone="info"
            title={`Trigger ${run.trigger_name ?? 'event'}`}
            code={triggerSource || run.trigger_id || '-'}
            meta={[
              `payload type ${stringField(graph.trigger_evidence, 'payload_type') ?? '-'}`,
              `provider event ${run.provider_event_id ?? '-'}`,
            ]}
            onClick={() => onSelectTarget('trigger')}
          />
        </div>
        <div className="absolute left-[272px] top-[128px] h-2 w-180 bg-border-neutral-strong" />
        <div className="absolute left-[268px] top-[123px] size-10 rounded-full border-2 border-background-neutral-base bg-foreground-neutral-muted" />
        <div className="absolute left-[448px] top-[123px] size-10 rounded-full border-2 border-background-neutral-base bg-foreground-neutral-muted" />
        <div className="absolute left-[452px] top-76 h-104 w-250">
          <GraphNode
            selected={selectedTarget === 'action'}
            tone="success"
            title="Action exec.run"
            code={displayActionLabel(action)}
            meta={[
              `argv ${JSON.stringify(action?.argv ?? [])}`,
              `status ${action?.status ?? '-'}, exit ${action?.exit_code ?? '-'}`,
            ]}
            onClick={() => onSelectTarget('action')}
          />
        </div>
      </div>
    </section>
  );
}

function GraphNode({
  selected,
  title,
  code,
  meta,
  onClick,
}: {
  selected: boolean;
  tone: 'info' | 'neutral' | 'success';
  title: string;
  code: string;
  meta: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-exec-node
      className={[
        'h-full w-full rounded-8 border bg-background-neutral-base p-12 text-left shadow-sm outline-none transition-colors',
        selected
          ? 'border-border-highlights-interactive bg-background-highlight-base shadow-border-interactive-with-active'
          : 'border-border-neutral-base hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active',
      ].join(' ')}
      onClick={onClick}
    >
      <Text size="sm" bold className="mb-6 truncate">
        {title}
      </Text>
      <Code className="block truncate">{code}</Code>
      {meta.map((line) => (
        <Text key={line} size="xs" className="mt-4 truncate text-foreground-neutral-muted">
          {line}
        </Text>
      ))}
    </button>
  );
}

function InspectorPanel({
  graph,
  selectedTarget,
  onOpenModal,
}: {
  graph: FoxlangRunGraphDto;
  selectedTarget: InspectorTarget;
  onOpenModal: (content: {title: string; value: string}) => void;
}) {
  const inspector = buildInspector(graph, selectedTarget);
  return (
    <aside className="overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base lg:sticky lg:top-112">
      <div className="flex min-h-48 items-center justify-between gap-12 border-b border-border-neutral-base px-14 py-12">
        <Text size="lg" bold className="truncate">
          {inspector.title}
        </Text>
        <StatusPill status={inspector.status} />
      </div>
      <dl className="grid grid-cols-[118px_minmax(0,1fr)] gap-x-10 gap-y-8 p-14">
        {inspector.rows.map((row) => (
          <InspectorRow
            key={row.name}
            name={row.name}
            value={row.value}
            stream={row.stream}
            onOpenModal={onOpenModal}
          />
        ))}
      </dl>
      {inspector.payload ? (
        <div className="border-t border-border-neutral-base p-14">
          <Code variant="label" className="mb-8 block text-foreground-neutral-muted">
            Payload
          </Code>
          <pre className="max-h-240 overflow-auto rounded-6 border border-border-neutral-base bg-background-subtle-base p-10 font-code text-sm leading-20">
            {JSON.stringify(inspector.payload, null, 2)}
          </pre>
        </div>
      ) : null}
    </aside>
  );
}

function InspectorRow({
  name,
  value,
  stream,
  onOpenModal,
}: {
  name: string;
  value: string;
  stream?: boolean;
  onOpenModal: (content: {title: string; value: string}) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <dt className="text-sm text-foreground-neutral-muted">{name}</dt>
      <dd className="min-w-0">
        {stream ? (
          <div className="min-w-0">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_24px_42px] items-center gap-6">
              <button
                type="button"
                className="truncate text-left font-code text-sm outline-none hover:text-foreground-highlight-interactive focus-visible:shadow-border-interactive-with-active"
                onClick={() => onOpenModal({title: name, value})}
              >
                {previewLine(value)}
              </button>
              <Button size="2xs" variant="secondary" onClick={() => setExpanded(!expanded)}>
                {expanded ? '-' : '+'}
              </Button>
              <Button
                size="2xs"
                variant="secondary"
                onClick={() => onOpenModal({title: name, value})}
              >
                open
              </Button>
            </div>
            {expanded ? (
              <pre className="mt-8 overflow-auto rounded-6 border border-border-neutral-base bg-background-subtle-base p-10 font-code text-sm leading-20">
                {value || '(empty)'}
              </pre>
            ) : null}
          </div>
        ) : (
          <Code className="block break-words" title={value}>
            {value || '-'}
          </Code>
        )}
      </dd>
    </>
  );
}

function LogsTab({
  runId,
  status,
  groups,
  search,
  onSearch,
  onRefresh,
  selectedTarget,
  onSelectTarget,
}: {
  runId: string;
  status: string;
  groups: LogGroup[];
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  selectedTarget: InspectorTarget;
  onSelectTarget: (target: InspectorTarget) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  function toggleGroup(groupId: string) {
    onSelectTarget('action');
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <section className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
        <div className="flex min-h-76 flex-wrap items-center justify-between gap-16 border-b border-border-neutral-base px-18 py-16">
          <div className="min-w-0">
            <Text size="lg" bold>
              Logs
            </Text>
            <div className="mt-4 flex min-w-0 items-center gap-8">
              <StatusPill status={status} />
              <Code className="truncate text-foreground-neutral-muted">{runId}</Code>
            </div>
          </div>
          <div className="flex w-[min(390px,100%)] items-center gap-8">
            <Input
              type="search"
              size="small"
              placeholder="Search logs"
              aria-label="Search logs"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
            <Button size="sm" variant="secondary" onClick={onRefresh}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="bg-background-subtle-base p-12">
          {groups.length > 0 ? (
            groups.map((group) => {
              const collapsed = collapsedGroups.has(group.id);
              return (
                <article
                  key={group.id}
                  className={[
                    'mb-10 overflow-hidden rounded-8 border last:mb-0',
                    selectedTarget === 'action'
                      ? 'border-border-highlights-interactive'
                      : 'border-transparent',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    className="grid min-h-42 w-full grid-cols-[26px_24px_minmax(0,1fr)_auto] items-center gap-8 rounded-6 bg-background-components-base px-12 text-left"
                    aria-expanded={!collapsed}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="text-lg leading-20">{collapsed ? '>' : 'v'}</span>
                    <span className="inline-flex h-18 w-20 items-center justify-center rounded-full bg-background-contrast-base text-xs text-foreground-neutral-on-inverted">
                      ✓
                    </span>
                    <Text size="sm" bold className="truncate">
                      {group.title}
                    </Text>
                    <Code className="text-foreground-neutral-muted">{group.meta}</Code>
                  </button>
                  {collapsed ? null : (
                    <div className="border-t border-border-neutral-base bg-background-neutral-base py-14">
                      {group.lines.map((line) => (
                        <div
                          key={`${group.id}-${line.no}`}
                          className="grid min-h-24 grid-cols-[54px_170px_minmax(0,1fr)] items-baseline gap-10 px-12 font-code text-sm leading-24 hover:bg-background-components-hover"
                        >
                          <span className="select-none text-right text-foreground-neutral-muted">
                            {line.no}
                          </span>
                          <span className="truncate text-foreground-neutral-muted">
                            {line.source}
                          </span>
                          <span className="min-w-0 break-words">{line.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            <Text size="sm" className="text-foreground-neutral-muted">
              No log lines match the current search.
            </Text>
          )}
        </div>
      </div>
    </section>
  );
}

function SourceTabPanel({
  workflowId,
  isPending,
  isError,
  sourceText,
  ifaceText,
  activeTab,
  onSelectTab,
  onRetry,
}: {
  workflowId: string | undefined;
  isPending: boolean;
  isError: boolean;
  sourceText: string;
  ifaceText: string;
  activeTab: SourceTab;
  onSelectTab: (tab: SourceTab) => void;
  onRetry: () => void;
}) {
  const activeText = activeTab === 'source' ? sourceText : ifaceText;

  if (!workflowId) {
    return (
      <Alert variant="error" animated={false}>
        <Text size="sm">This run does not include a workflow id for source lookup.</Text>
      </Alert>
    );
  }

  return (
    <section className="overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <div className="flex min-h-48 flex-wrap items-center justify-between gap-12 border-b border-border-neutral-base px-14 py-12">
        <div className="min-w-0">
          <Text size="lg" bold>
            Source code
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted">
            Workflow source and generated interface for this project.
          </Text>
        </div>
        <div className="flex gap-6" role="tablist" aria-label="Source file tabs">
          <SourceTabButton active={activeTab === 'source'} onClick={() => onSelectTab('source')}>
            .fox
          </SourceTabButton>
          <SourceTabButton active={activeTab === 'iface'} onClick={() => onSelectTab('iface')}>
            .fox.iface
          </SourceTabButton>
        </div>
      </div>
      {isPending ? (
        <div className="p-14">
          <Skeleton className="h-320 w-full" />
        </div>
      ) : null}
      {isError ? (
        <div className="p-14">
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Source unavailable
              </Text>
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}
      {!isPending && !isError ? (
        <pre className="min-h-560 overflow-auto p-14 font-code text-sm leading-20 text-foreground-neutral-base">
          {activeText || 'No source text returned by the local service.'}
        </pre>
      ) : null}
    </section>
  );
}

function SourceTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={[
        'h-28 rounded-6 border px-10 text-sm text-foreground-neutral-muted transition-colors outline-none hover:bg-background-components-hover hover:text-foreground-neutral-base focus-visible:shadow-border-interactive-with-active',
        active
          ? 'border-border-highlights-interactive bg-background-highlight-base text-foreground-highlight-interactive'
          : 'border-transparent bg-transparent',
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusPill({status}: {status: string}) {
  const variant = statusVariant[status] ?? 'neutral';
  return (
    <span
      className={[
        'inline-flex h-22 items-center gap-6 rounded-full border px-8 text-xs',
        statusPillClassByVariant[variant],
      ].join(' ')}
    >
      <StatusDot variant={variant} />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function buildInspector(graph: FoxlangRunGraphDto, selectedTarget: InspectorTarget) {
  const run = graph.run;
  const action = graph.actions[0];
  if (selectedTarget === 'trigger') {
    const source = [
      stringField(graph.trigger_evidence, 'source_alias'),
      stringField(graph.trigger_evidence, 'source_event'),
    ]
      .filter(Boolean)
      .join('.');
    const value = objectField(graph.trigger_evidence, 'value');
    return {
      title: `Trigger ${run.trigger_name ?? 'event'}`,
      status: 'received',
      payload: value,
      rows: [
        row('trigger_id', run.trigger_id ?? stringField(graph.trigger_evidence, 'trigger_id')),
        row('source', source || null),
        row('provider_event_id', run.provider_event_id),
        row('payload_type', stringField(graph.trigger_evidence, 'payload_type')),
        row('evidence_id', stringField(graph.trigger_evidence, 'evidence_id')),
        row('input.id', bridgeRecordField(value, 'id')),
        row('input.severity', bridgeRecordField(value, 'severity')),
        row('input.message', bridgeRecordField(value, 'message')),
        row('starts', `${run.workflow_name ?? 'workflow'}(alert)`),
      ],
    };
  }

  return {
    title: 'Action exec.run',
    status: action?.status ?? 'runner_failed',
    payload: null,
    rows: [
      row('action_record_id', actionId(run.run_id, action)),
      row('action', displayActionLabel(action)),
      row('service', 'exec.run'),
      row('argv', JSON.stringify(action?.argv ?? [])),
      row('status', action?.status),
      row('exit_code', action?.exit_code == null ? null : String(action.exit_code)),
      row('stdout', action?.stdout ?? '', true),
      row('stderr', action?.stderr ?? '', true),
    ],
  };
}

function row(name: string, value: string | null | undefined, stream = false) {
  return {name, value: value ?? '', stream};
}

interface LogGroup {
  id: string;
  title: string;
  meta: string;
  lines: Array<{no: number; source: string; message: string}>;
}

function buildLogGroups(graph: FoxlangRunGraphDto | undefined): LogGroup[] {
  if (!graph) return [];
  return graph.actions.flatMap((action, index) => {
    const groups: LogGroup[] = [];
    for (const stream of ['stdout', 'stderr'] as const) {
      const value = action[stream] ?? '';
      if (!value) continue;
      groups.push({
        id: `${index}-${stream}`,
        title: stream,
        meta: 'exec.run',
        lines: value.split(LINE_SPLIT_RE).map((message, lineIndex) => ({
          no: lineIndex + 1,
          source: stream,
          message,
        })),
      });
    }
    return groups;
  });
}

function filterLogGroups(groups: LogGroup[], search: string): LogGroup[] {
  const query = search.trim().toLowerCase();
  if (!query) return groups;
  return groups
    .map((group) => ({
      ...group,
      lines: group.lines.filter((line) =>
        `${line.source} ${line.message}`.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.lines.length > 0);
}

function actionId(runId: string, action: FoxlangActionRecordDto | undefined): string {
  return stringField(action, 'action_record_id') ?? `${runId}::action:001`;
}

function displayActionLabel(action: FoxlangActionRecordDto | undefined): string {
  const requirement = action?.action_requirement_id;
  if (requirement?.startsWith('@')) return requirement;
  if (action?.argv) return '@fox/std.process.exec';
  return requirement ?? '@fox/std.process.exec';
}

function previewLine(value: string): string {
  const firstLine = value.split(LINE_SPLIT_RE)[0] || '(empty)';
  return firstLine.length > 84 ? `${firstLine.slice(0, 81)}...` : firstLine;
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

function objectField(value: unknown, key: string): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'object' && field !== null ? (field as Record<string, unknown>) : null;
}

function bridgeRecordField(value: unknown, key: string): string | null {
  if (!isBridgeRecord(value)) return null;
  const field = value.fields.find((item) => item.name === key);
  if (!field) return null;
  return bridgeValueToString(field.value);
}

function bridgeValueToString(value: FoxlangBridgeValueDto): string {
  if (value.kind === 'string') return value.value;
  if (value.kind === 'int') return String(value.value);
  if (value.kind === 'list') return `[${value.items.map(bridgeValueToString).join(', ')}]`;
  return `{${value.fields.map((field) => `${field.name}: ${bridgeValueToString(field.value)}`).join(', ')}}`;
}

function isBridgeRecord(value: unknown): value is Extract<FoxlangBridgeValueDto, {kind: 'record'}> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as {kind?: unknown}).kind === 'record' &&
    Array.isArray((value as {fields?: unknown}).fields)
  );
}
