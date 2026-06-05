import type {SurfaceWorkflowDocument} from '#core/surface/surface-workflow-document.js';
import {createDefaultRunExitCodeAcceptancePolicy} from './expression-ir.js';
import {
  createJobId,
  createStepId,
  createTriggerId,
  createUniqueId,
  createWorkflowId,
} from './ids.js';
import type {
  JobDependencyIR,
  JobIR,
  RunnerSelectorIR,
  StepIR,
  TriggerIR,
  WorkflowIR,
} from './workflow-ir.js';

export function normalizeSurfaceDocumentToWorkflowIR(
  document: SurfaceWorkflowDocument,
): WorkflowIR {
  const jobNameToId = createNameToIdMap(Object.keys(document.jobs), createJobId);
  const usedStepIds = new Set<string>();
  const steps: StepIR[] = [];
  const dependencies: JobDependencyIR[] = [];

  const jobs: JobIR[] = [...jobNameToId.entries()].map(([jobName, jobId]) => {
    const job = document.jobs[jobName];
    if (!job) {
      throw new Error(`Normalized job missing from source document: ${jobName}`);
    }

    const jobDependencies = normalizeDependencyList(job.needs)
      // Preserve unresolved surface references for static semantics instead of
      // slugging them into phantom or accidentally real job IDs.
      .map((dependencyName) => jobNameToId.get(dependencyName) ?? dependencyName)
      .sort(compareIds);

    for (const dependencyId of jobDependencies) {
      dependencies.push({from: dependencyId, to: jobId});
    }

    const stepIds = job.steps.map((step) => {
      const stepId = createStepId({
        jobId,
        stepName: step.name,
        run: step.run,
        usedStepIds,
      });
      usedStepIds.add(stepId);
      steps.push({
        kind: 'run',
        id: stepId,
        jobId,
        name: step.name ?? null,
        command: {kind: 'shell', value: step.run},
        acceptance: createDefaultRunExitCodeAcceptancePolicy(),
      });
      return stepId;
    });

    return {
      id: jobId,
      sourceName: jobName,
      dependencies: jobDependencies,
      runner: normalizeRunnerSelector(job.runner),
      steps: stepIds,
    };
  });

  return {
    id: createWorkflowId(document.name),
    name: document.name,
    triggers: normalizeTriggers(document),
    runner: normalizeRunnerSelector(document.runner),
    jobs,
    steps,
    dependencies: dependencies.sort((left, right) => {
      const from = compareIds(left.from, right.from);
      return from === 0 ? compareIds(left.to, right.to) : from;
    }),
  };
}

function normalizeTriggers(document: SurfaceWorkflowDocument): TriggerIR[] {
  const triggerNameToId = createNameToIdMap(Object.keys(document.triggers ?? {}), createTriggerId);
  return [...triggerNameToId.entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([triggerName, triggerId]) => {
      const trigger = document.triggers?.[triggerName];
      if (!trigger) {
        throw new Error(`Normalized trigger missing from source document: ${triggerName}`);
      }
      return {
        id: triggerId,
        source: trigger.source,
        event: trigger.event,
        on: normalizeStringList(trigger.on),
        with: trigger.with ?? null,
        filter: trigger.filter ?? null,
      };
    });
}

function createNameToIdMap(
  names: Iterable<string>,
  createBaseId: (name: string) => string,
): Map<string, string> {
  const usedIds = new Set<string>();
  return new Map(
    [...names].sort(compareIds).map((name) => {
      const id = createUniqueId(createBaseId(name), usedIds);
      usedIds.add(id);
      return [name, id] as const;
    }),
  );
}

function normalizeRunnerSelector(value: string | string[] | undefined): RunnerSelectorIR | null {
  return normalizeStringList(value);
}

function normalizeDependencyList(value: string | string[] | undefined): readonly string[] {
  return normalizeStringList(value) ?? [];
}

function normalizeStringList(value: string | string[] | undefined): readonly string[] | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value : [value];
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
