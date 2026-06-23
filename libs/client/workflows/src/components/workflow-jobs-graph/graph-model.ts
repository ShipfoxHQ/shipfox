import type {JobStatusDto, RunDetailResponseDto, RunJobDetailDto} from '@shipfox/api-workflows-dto';

export interface WorkflowGraphTriggerNode {
  id: 'trigger';
  source: string;
  event: string;
  label: string;
  column: 0;
  row: 0;
}

export interface WorkflowJobGraphNode {
  id: string;
  label: string;
  position: number;
  sourceStatus: JobStatusDto;
  column: number;
  row: number;
  dependencies: string[];
}

export type WorkflowJobGraphNavigationKey =
  | 'ArrowRight'
  | 'ArrowLeft'
  | 'ArrowDown'
  | 'ArrowUp'
  | 'j'
  | 'k';

export interface WorkflowJobGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'trigger' | 'dependency';
}

export interface WorkflowJobGraphModel {
  trigger: WorkflowGraphTriggerNode;
  nodes: WorkflowJobGraphNode[];
  edges: WorkflowJobGraphEdge[];
  columns: WorkflowJobGraphNode[][];
}

export function buildWorkflowJobGraphModel({
  run,
}: {
  run: RunDetailResponseDto;
}): WorkflowJobGraphModel {
  const sortedJobs = [...run.jobs].sort(compareJobs);
  const byName = new Map(sortedJobs.map((job) => [job.name, job]));
  const columnMemo = new Map<string, number>();

  function columnFor(job: RunJobDetailDto, visiting = new Set<string>()): number {
    const cached = columnMemo.get(job.id);
    if (cached !== undefined) return cached;
    if (visiting.has(job.id)) return 0;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(job.id);

    const dependencyColumns = job.dependencies
      .map((dependencyName) => byName.get(dependencyName))
      .filter((dependency): dependency is RunJobDetailDto => dependency !== undefined)
      .map((dependency) => columnFor(dependency, nextVisiting));

    const column = dependencyColumns.length === 0 ? 0 : Math.max(...dependencyColumns) + 1;
    columnMemo.set(job.id, column);
    return column;
  }

  const nodesWithoutRows = sortedJobs.map((job) => ({
    id: job.id,
    label: job.name,
    position: job.position,
    sourceStatus: job.status,
    column: columnFor(job),
    row: 0,
    dependencies: job.dependencies,
  }));

  const grouped = groupColumns(nodesWithoutRows);
  const nodes = grouped.flat();
  const edges = buildEdges(sortedJobs, byName);

  return {
    trigger: {
      id: 'trigger',
      source: run.trigger_source,
      event: run.trigger_event,
      label: triggerLabel(run),
      column: 0,
      row: 0,
    },
    nodes,
    edges,
    columns: grouped,
  };
}

function compareJobs(left: RunJobDetailDto, right: RunJobDetailDto): number {
  return (
    left.position - right.position ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function groupColumns(nodes: WorkflowJobGraphNode[]): WorkflowJobGraphNode[][] {
  const byColumn = new Map<number, WorkflowJobGraphNode[]>();
  for (const node of nodes) {
    const column = byColumn.get(node.column) ?? [];
    column.push(node);
    byColumn.set(node.column, column);
  }

  return [...byColumn.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, column]) =>
      column
        .sort(
          (left, right) =>
            left.position - right.position ||
            left.label.localeCompare(right.label) ||
            left.id.localeCompare(right.id),
        )
        .map((node, row) => ({...node, row})),
    );
}

function buildEdges(
  jobs: readonly RunJobDetailDto[],
  byName: ReadonlyMap<string, RunJobDetailDto>,
): WorkflowJobGraphEdge[] {
  const triggerEdges = jobs
    .filter((job) => job.dependencies.length === 0)
    .map((job) => ({
      id: `trigger:${job.id}`,
      from: 'trigger',
      to: job.id,
      kind: 'trigger' as const,
    }));

  const dependencyEdges = jobs.flatMap((job) =>
    job.dependencies.flatMap((dependencyName) => {
      const dependency = byName.get(dependencyName);
      if (!dependency) return [];
      return [
        {
          id: `${dependency.id}:${job.id}`,
          from: dependency.id,
          to: job.id,
          kind: 'dependency' as const,
        },
      ];
    }),
  );

  return [...triggerEdges, ...dependencyEdges];
}

export function nextWorkflowJobGraphNodeId({
  model,
  currentNodeId,
  key,
}: {
  model: WorkflowJobGraphModel;
  currentNodeId: string;
  key: WorkflowJobGraphNavigationKey;
}): string | undefined {
  const current = model.nodes.find((node) => node.id === currentNodeId);
  if (!current) return undefined;

  switch (key) {
    case 'ArrowRight':
      return nodeInAdjacentColumn(model, current, 1)?.id;
    case 'ArrowLeft':
      return nodeInAdjacentColumn(model, current, -1)?.id;
    case 'ArrowDown':
    case 'j':
      return model.columns[current.column]?.[current.row + 1]?.id;
    case 'ArrowUp':
    case 'k':
      return model.columns[current.column]?.[current.row - 1]?.id;
  }
}

function nodeInAdjacentColumn(
  model: WorkflowJobGraphModel,
  current: WorkflowJobGraphNode,
  offset: -1 | 1,
): WorkflowJobGraphNode | undefined {
  const column = model.columns[current.column + offset];
  if (!column || column.length === 0) return undefined;
  return column[Math.min(current.row, column.length - 1)];
}

function triggerLabel(run: Pick<RunDetailResponseDto, 'trigger_source' | 'trigger_event'>): string {
  if (!run.trigger_source && !run.trigger_event) return 'trigger';
  if (!run.trigger_source) return run.trigger_event;
  if (!run.trigger_event) return run.trigger_source;
  return `${run.trigger_source} / ${run.trigger_event}`;
}
