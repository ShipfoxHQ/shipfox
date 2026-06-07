import type {WorkflowIR} from '#core/ir/workflow-ir.js';
import {type StaticDiagnostic, staticDiagnosticIds} from './diagnostic.js';
import {staticDiagnosticReference} from './static-diagnostic-reference.js';
import {validateWorkflowIRStaticSemantics} from './validate-workflow-ir.js';

describe('staticDiagnosticReference', () => {
  test('documents every static diagnostic ID', () => {
    const documentedIds = staticDiagnosticReference.map((diagnostic) => diagnostic.id);

    expect(documentedIds).toEqual(Object.values(staticDiagnosticIds));
  });

  test('uses only registered diagnostic IDs', () => {
    const registeredIds = new Set(Object.values(staticDiagnosticIds));

    for (const diagnostic of staticDiagnosticReference) {
      expect(registeredIds.has(diagnostic.id)).toBe(true);
    }
  });

  test('documents severity, condition, path, message, and notes for each diagnostic', () => {
    for (const diagnostic of staticDiagnosticReference) {
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.condition.length).toBeGreaterThan(0);
      expect(diagnostic.pathShape.length).toBeGreaterThan(0);
      expect(diagnostic.messageExample.length).toBeGreaterThan(0);
      expect(diagnostic.notes.length).toBeGreaterThan(0);
    }
  });

  test.each([
    {
      id: staticDiagnosticIds.unknownJobDependency,
      ir: workflowIR({
        jobs: [job('build')],
        dependencies: [{from: 'missing', to: 'build'}],
      }),
    },
    {
      id: staticDiagnosticIds.selfJobDependency,
      ir: workflowIR({
        jobs: [job('build')],
        dependencies: [{from: 'build', to: 'build'}],
      }),
    },
    {
      id: staticDiagnosticIds.cyclicJobDependency,
      ir: workflowIR({
        jobs: [job('a'), job('b'), job('c')],
        dependencies: [
          {from: 'a', to: 'b'},
          {from: 'b', to: 'c'},
          {from: 'c', to: 'a'},
        ],
      }),
    },
    {
      id: staticDiagnosticIds.unknownDependentJob,
      ir: workflowIR({
        jobs: [job('build')],
        dependencies: [{from: 'build', to: 'missing'}],
      }),
    },
  ])('keeps the $id reference example aligned with validator output', ({id, ir}) => {
    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const diagnostic = firstDiagnostic(result.diagnostics, id);
      const reference = staticDiagnosticReference.find((item) => item.id === id);

      expect(reference?.messageExample).toBe(diagnostic.message);
      expect(pathMatchesShape(reference?.pathShape, diagnostic.path)).toBe(true);
    }
  });
});

function firstDiagnostic(
  diagnostics: readonly StaticDiagnostic[],
  id: StaticDiagnostic['id'],
): StaticDiagnostic {
  const diagnostic = diagnostics.find((item) => item.id === id);
  expect(diagnostic).toBeDefined();
  return diagnostic as StaticDiagnostic;
}

function workflowIR(overrides: Partial<WorkflowIR>): WorkflowIR {
  return {
    id: 'test-workflow',
    name: 'Test workflow',
    triggers: [],
    runner: null,
    jobs: [],
    steps: [],
    dependencies: [],
    ...overrides,
  };
}

function job(id: string) {
  return {id, sourceName: id, position: 0, dependencies: [], runner: null, steps: []};
}

function pathMatchesShape(
  pathShape: string | undefined,
  path: readonly (string | number)[],
): boolean {
  switch (pathShape) {
    case '`["jobs", <dependent sourceName>, "needs"]`':
    case '`["jobs", <job sourceName>, "needs"]`':
      return (
        path.length === 3 &&
        path[0] === 'jobs' &&
        typeof path[1] === 'string' &&
        path[2] === 'needs'
      );
    case '`["jobs"]`':
      return path.length === 1 && path[0] === 'jobs';
    case '`["dependencies", <edge index>, "to"]`':
      return (
        path.length === 3 &&
        path[0] === 'dependencies' &&
        typeof path[1] === 'number' &&
        path[2] === 'to'
      );
    default:
      return false;
  }
}
