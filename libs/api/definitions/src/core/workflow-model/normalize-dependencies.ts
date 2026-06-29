import type {WorkflowDocumentJob} from '@shipfox/workflow-document';
import type {WorkflowModelDependency} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {normalizeNeeds} from './normalize-needs.js';
import {issue} from './validation-issue.js';

export function normalizeDependencies(
  jobs: Readonly<Record<string, WorkflowDocumentJob>>,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelDependency[] {
  const dependencies: WorkflowModelDependency[] = [];

  for (const [sourceName, job] of Object.entries(jobs)) {
    const to = jobIdBySourceName.get(sourceName);
    if (to === undefined) continue;

    for (const dependencySourceName of normalizeNeeds(job.needs)) {
      if (!jobIdBySourceName.has(dependencySourceName)) {
        issues.push(
          issue({
            code: 'unknown-job-dependency',
            message: `Job "${sourceName}" depends on unknown job "${dependencySourceName}".`,
            path: ['jobs', sourceName, 'needs'],
            details: {job: sourceName, dependency: dependencySourceName},
          }),
        );
        continue;
      }

      if (dependencySourceName === sourceName) {
        issues.push(
          issue({
            code: 'self-job-dependency',
            message: `Job "${sourceName}" depends on itself.`,
            path: ['jobs', sourceName, 'needs'],
            details: {job: sourceName},
          }),
        );
        continue;
      }

      dependencies.push({from: jobIdBySourceName.get(dependencySourceName) as string, to});
    }
  }

  return dependencies;
}

export function validateCycles(
  jobs: Readonly<Record<string, WorkflowDocumentJob>>,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
): void {
  const jobNames = Object.keys(jobs);
  const adjacency = new Map<string, string[]>();

  for (const name of jobNames) {
    adjacency.set(name, []);
  }

  for (const [name, job] of Object.entries(jobs)) {
    for (const dependency of normalizeNeeds(job.needs)) {
      if (!jobIdBySourceName.has(dependency) || dependency === name) continue;

      adjacency.get(dependency)?.push(name);
    }
  }

  const cyclicNames = findCyclicSourceNames(jobNames, adjacency);
  if (cyclicNames.length > 0) {
    issues.push(
      issue({
        code: 'job-dependency-cycle',
        message: `Circular dependency detected among jobs: ${cyclicNames.join(', ')}.`,
        path: ['jobs'],
        details: {
          cycleSourceNames: cyclicNames,
          cycleJobIds: cyclicNames.flatMap((name) => {
            const id = jobIdBySourceName.get(name);
            return id === undefined ? [] : [id];
          }),
        },
      }),
    );
  }
}

function findCyclicSourceNames(
  jobNames: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclicNames = new Set<string>();
  let index = 0;

  const visit = (node: string) => {
    indexes.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!indexes.has(neighbor)) {
        visit(neighbor);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node) as number, lowLinks.get(neighbor) as number),
        );
      } else if (onStack.has(neighbor)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) as number, indexes.get(neighbor) as number));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;

    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop() as string;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }

    if (component.length > 1) {
      for (const member of component) cyclicNames.add(member);
    }
  };

  for (const name of jobNames) {
    if (!indexes.has(name)) visit(name);
  }

  return jobNames.filter((name) => cyclicNames.has(name));
}
