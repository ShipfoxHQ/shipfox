import type {WorkflowJob, WorkflowRunDetail} from '#core/workflow-run.js';
import {type JobDurationDisplay, jobDurationDisplay} from './job-duration.js';

export interface WorkflowJobGraphNode extends WorkflowJob {
  column: number;
  row: number;
  currentDependencyCount: number;
  duration: JobDurationDisplay;
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
  nodes: WorkflowJobGraphNode[];
  edges: WorkflowJobGraphEdge[];
  columns: WorkflowJobGraphNode[][];
}

export function buildWorkflowJobGraphModel({run}: {run: WorkflowRunDetail}): WorkflowJobGraphModel {
  const sortedJobs = [...run.jobs].sort(compareJobs);
  const byName = new Map(sortedJobs.map((job) => [job.name, job]));
  const columnMemo = new Map<string, number>();

  function columnFor(job: WorkflowJob, visiting = new Set<string>()): number {
    const cached = columnMemo.get(job.id);
    if (cached !== undefined) return cached;
    if (visiting.has(job.id)) return 0;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(job.id);

    const dependencyColumns = job.dependencies
      .map((dependencyName) => byName.get(dependencyName))
      .filter((dependency): dependency is WorkflowJob => dependency !== undefined)
      .map((dependency) => columnFor(dependency, nextVisiting));

    const column = dependencyColumns.length === 0 ? 0 : Math.max(...dependencyColumns) + 1;
    columnMemo.set(job.id, column);
    return column;
  }

  const nodesWithoutRows = sortedJobs.map((job) => ({
    ...job,
    column: columnFor(job),
    row: 0,
    currentDependencyCount: currentDependencyCount(job, byName),
    duration: jobDurationDisplay(job),
  }));

  const grouped = groupColumns(nodesWithoutRows);
  const nodes = grouped.flat();
  const edges = buildEdges(sortedJobs, byName);

  return {
    nodes,
    edges,
    columns: grouped,
  };
}

function compareJobs(left: WorkflowJob, right: WorkflowJob): number {
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
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        )
        .map((node, row) => ({...node, row})),
    );
}

function buildEdges(
  jobs: readonly WorkflowJob[],
  byName: ReadonlyMap<string, WorkflowJob>,
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

function currentDependencyCount(
  job: WorkflowJob,
  byName: ReadonlyMap<string, WorkflowJob>,
): number {
  return job.dependencies.filter((dependencyName) => {
    const dependency = byName.get(dependencyName);
    return dependency?.status === 'pending' || dependency?.status === 'running';
  }).length;
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
