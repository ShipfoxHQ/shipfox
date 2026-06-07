import type {JobDependencyIR, WorkflowIR} from '#core/ir/workflow-ir.js';
import {
  type StaticDiagnostic,
  type StaticSemanticsResult,
  staticDiagnosticIds,
} from './diagnostic.js';

export function validateWorkflowIRStaticSemantics(ir: WorkflowIR): StaticSemanticsResult {
  const diagnostics: StaticDiagnostic[] = [];
  const jobsById = new Map(ir.jobs.map((job) => [job.id, job] as const));
  const jobIds = new Set(jobsById.keys());

  for (const [index, edge] of ir.dependencies.entries()) {
    if (!jobIds.has(edge.from)) {
      diagnostics.push(unknownJobDependency(edge, jobsById.get(edge.to)?.sourceName ?? edge.to));
    }
    if (!jobIds.has(edge.to)) {
      diagnostics.push(unknownDependentJob(edge, index));
    }
    if (jobIds.has(edge.from) && jobIds.has(edge.to) && edge.from === edge.to) {
      diagnostics.push(selfJobDependency(jobsById.get(edge.to)?.sourceName ?? edge.to));
    }
  }

  if (diagnostics.length === 0) {
    const cycle = findCycle(ir, jobIds);
    if (cycle.length > 0) {
      diagnostics.push(
        cyclicJobDependency(cycle.map((jobId) => jobsById.get(jobId)?.sourceName ?? jobId)),
      );
    }
  }

  return diagnostics.length === 0 ? {valid: true, diagnostics: []} : {valid: false, diagnostics};
}

function unknownJobDependency(edge: JobDependencyIR, dependentJobName: string): StaticDiagnostic {
  return {
    id: staticDiagnosticIds.unknownJobDependency,
    severity: 'error',
    message: `Job "${dependentJobName}" depends on unknown job "${edge.from}"`,
    path: ['jobs', dependentJobName, 'needs'],
  };
}

function unknownDependentJob(edge: JobDependencyIR, index: number): StaticDiagnostic {
  return {
    id: staticDiagnosticIds.unknownDependentJob,
    severity: 'error',
    message: `Dependency edge targets unknown job "${edge.to}"`,
    path: ['dependencies', index, 'to'],
  };
}

function selfJobDependency(jobName: string): StaticDiagnostic {
  return {
    id: staticDiagnosticIds.selfJobDependency,
    severity: 'error',
    message: `Job "${jobName}" depends on itself`,
    path: ['jobs', jobName, 'needs'],
  };
}

function cyclicJobDependency(cycle: readonly string[]): StaticDiagnostic {
  return {
    id: staticDiagnosticIds.cyclicJobDependency,
    severity: 'error',
    message: `Circular dependency detected among jobs: ${cycle.join(', ')}`,
    path: ['jobs'],
  };
}

function findCycle(ir: WorkflowIR, jobIds: ReadonlySet<string>): string[] {
  if (jobIds.size === 0) return [];

  const adjacency = new Map<string, string[]>();

  for (const id of jobIds) {
    adjacency.set(id, []);
  }

  for (const edge of ir.dependencies) {
    const neighbors = adjacency.get(edge.from);
    if (neighbors) neighbors.push(edge.to);
  }

  const components = findStronglyConnectedComponents([...jobIds], adjacency);
  const cyclicJobIds = new Set(
    components
      .filter(
        (component) =>
          component.length > 1 ||
          component.some((jobId) => adjacency.get(jobId)?.includes(jobId) ?? false),
      )
      .flat(),
  );

  return [...jobIds].filter((id) => cyclicJobIds.has(id));
}

function findStronglyConnectedComponents(
  jobIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const indexById = new Map<string, number>();
  const lowLinkById = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  function connect(jobId: string): void {
    indexById.set(jobId, nextIndex);
    lowLinkById.set(jobId, nextIndex);
    nextIndex += 1;
    stack.push(jobId);
    onStack.add(jobId);

    for (const neighbor of adjacency.get(jobId) ?? []) {
      if (!indexById.has(neighbor)) {
        connect(neighbor);
        lowLinkById.set(
          jobId,
          Math.min(lowLinkById.get(jobId) as number, lowLinkById.get(neighbor) as number),
        );
      } else if (onStack.has(neighbor)) {
        lowLinkById.set(
          jobId,
          Math.min(lowLinkById.get(jobId) as number, indexById.get(neighbor) as number),
        );
      }
    }

    if (lowLinkById.get(jobId) !== indexById.get(jobId)) return;

    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (current === undefined) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== jobId);
    components.push(component);
  }

  for (const jobId of jobIds) {
    if (!indexById.has(jobId)) {
      connect(jobId);
    }
  }

  return components;
}
