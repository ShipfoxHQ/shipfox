import type {Job, WorkflowRunDetail} from '#core/workflow-run.js';

export type JobGraphNode = Job & {
  column: number;
  row: number;
  currentDependencyCount: number;
};

export type JobGraphNavigationKey =
  | 'ArrowRight'
  | 'ArrowLeft'
  | 'ArrowDown'
  | 'ArrowUp'
  | 'j'
  | 'k';

export interface JobGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'trigger' | 'dependency';
}

export interface JobGraphModel {
  nodes: JobGraphNode[];
  edges: JobGraphEdge[];
  columns: JobGraphNode[][];
}

export function buildJobGraphModel({run}: {run: WorkflowRunDetail}): JobGraphModel {
  const sortedJobs = [...run.jobs].sort(compareJobs);
  const byKey = new Map(sortedJobs.map((job) => [job.key, job]));
  const columnMemo = new Map<string, number>();

  function columnFor(job: Job, visiting = new Set<string>()): number {
    const cached = columnMemo.get(job.id);
    if (cached !== undefined) return cached;
    if (visiting.has(job.id)) return 0;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(job.id);

    const dependencyColumns = job.dependencies
      .map((dependencyKey) => byKey.get(dependencyKey))
      .filter((dependency): dependency is Job => dependency !== undefined)
      .map((dependency) => columnFor(dependency, nextVisiting));

    const column = dependencyColumns.length === 0 ? 0 : Math.max(...dependencyColumns) + 1;
    columnMemo.set(job.id, column);
    return column;
  }

  const nodesWithoutRows = sortedJobs.map((job) =>
    jobGraphNode(job, {
      column: columnFor(job),
      row: 0,
      currentDependencyCount: currentDependencyCount(job, byKey),
    }),
  );

  const grouped = groupColumns(nodesWithoutRows);
  const nodes = grouped.flat();
  const edges = buildEdges(sortedJobs, byKey);

  return {
    nodes,
    edges,
    columns: grouped,
  };
}

function compareJobs(left: Job, right: Job): number {
  return (
    left.position - right.position ||
    (left.name ?? left.key).localeCompare(right.name ?? right.key) ||
    left.id.localeCompare(right.id)
  );
}

function groupColumns(nodes: JobGraphNode[]): JobGraphNode[][] {
  const byColumn = new Map<number, JobGraphNode[]>();
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
            (left.name ?? left.key).localeCompare(right.name ?? right.key) ||
            left.id.localeCompare(right.id),
        )
        .map((node, row) => jobGraphNode(node, {...node, row})),
    );
}

function buildEdges(jobs: readonly Job[], byKey: ReadonlyMap<string, Job>): JobGraphEdge[] {
  const triggerEdges = jobs
    .filter((job) => job.dependencies.length === 0)
    .map((job) => ({
      id: `trigger:${job.id}`,
      from: 'trigger',
      to: job.id,
      kind: 'trigger' as const,
    }));

  const dependencyEdges = jobs.flatMap((job) =>
    job.dependencies.flatMap((dependencyKey) => {
      const dependency = byKey.get(dependencyKey);
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

function currentDependencyCount(job: Job, byKey: ReadonlyMap<string, Job>): number {
  return job.dependencies.filter((dependencyKey) => {
    const dependency = byKey.get(dependencyKey);
    return dependency?.status === 'pending' || dependency?.status === 'running';
  }).length;
}

function jobGraphNode(
  job: Job,
  layout: Pick<JobGraphNode, 'column' | 'row' | 'currentDependencyCount'>,
): JobGraphNode {
  return Object.assign(Object.create(Object.getPrototypeOf(job)), job, layout);
}

export function nextJobGraphNodeId({
  model,
  currentNodeId,
  key,
}: {
  model: JobGraphModel;
  currentNodeId: string;
  key: JobGraphNavigationKey;
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
  model: JobGraphModel,
  current: JobGraphNode,
  offset: -1 | 1,
): JobGraphNode | undefined {
  const column = model.columns[current.column + offset];
  if (!column || column.length === 0) return undefined;
  return column[Math.min(current.row, column.length - 1)];
}
