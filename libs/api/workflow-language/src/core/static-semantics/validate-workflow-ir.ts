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
  const inDegree = new Map<string, number>();

  for (const id of jobIds) {
    adjacency.set(id, []);
    inDegree.set(id, 0);
  }

  for (const edge of ir.dependencies) {
    const neighbors = adjacency.get(edge.from);
    if (neighbors) neighbors.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift() as string;
    sorted.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const nextDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nextDegree);
      if (nextDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length === jobIds.size) return [];
  return [...jobIds].filter((id) => !sorted.includes(id));
}
