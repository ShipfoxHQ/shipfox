import {
  type StaticDiagnosticId,
  type StaticDiagnosticSeverity,
  staticDiagnosticIds,
} from './diagnostic.js';

export type StaticDiagnosticReference = Readonly<{
  id: StaticDiagnosticId;
  severity: StaticDiagnosticSeverity;
  condition: string;
  pathShape: string;
  messageExample: string;
  notes: string;
}>;

export const staticDiagnosticReference: readonly StaticDiagnosticReference[] = [
  {
    id: staticDiagnosticIds.unknownJobDependency,
    severity: 'error',
    condition: 'A dependency edge `from` prerequisite is not present in `WorkflowIR.jobs`.',
    pathShape: '`["jobs", <dependent sourceName>, "needs"]`',
    messageExample: 'Job "build" depends on unknown job "missing"',
    notes:
      'Produced for authoring references such as `needs: missing` after surface normalization.',
  },
  {
    id: staticDiagnosticIds.selfJobDependency,
    severity: 'error',
    condition: 'A dependency edge starts and ends at the same existing job ID.',
    pathShape: '`["jobs", <job sourceName>, "needs"]`',
    messageExample: 'Job "build" depends on itself',
    notes: 'Reported before cycle analysis because self-dependencies are direct reference errors.',
  },
  {
    id: staticDiagnosticIds.cyclicJobDependency,
    severity: 'error',
    condition:
      'All dependency endpoints resolve, no self-dependencies are present, and the job graph contains a cycle.',
    pathShape: '`["jobs"]`',
    messageExample: 'Circular dependency detected among jobs: a, b, c',
    notes:
      'Reported only after reference diagnostics are absent so cycle analysis uses resolvable edges.',
  },
  {
    id: staticDiagnosticIds.unknownDependentJob,
    severity: 'error',
    condition: 'A dependency edge `to` dependent is not present in `WorkflowIR.jobs`.',
    pathShape: '`["dependencies", <edge index>, "to"]`',
    messageExample: 'Dependency edge targets unknown job "missing"',
    notes:
      'Primarily protects hand-built or future cached IR because YAML normalization creates target jobs from the job map.',
  },
];
