import {normalizeSurfaceDocumentToWorkflowIR} from '#core/ir/normalize-surface-document.js';
import type {WorkflowIR} from '#core/ir/workflow-ir.js';
import type {SurfaceWorkflowDocument} from '#core/surface/surface-workflow-document.js';
import {staticDiagnosticIds} from './diagnostic.js';
import {validateWorkflowIRStaticSemantics} from './validate-workflow-ir.js';

describe('validateWorkflowIRStaticSemantics', () => {
  test('accepts an acyclic workflow IR', () => {
    const ir = workflowIR({
      jobs: [job('build', []), job('test', ['build']), job('deploy', ['build', 'test'])],
      dependencies: [
        {from: 'build', to: 'deploy'},
        {from: 'build', to: 'test'},
        {from: 'test', to: 'deploy'},
      ],
    });

    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(true);
  });

  test('reports unknown job dependencies with stable diagnostic ID', () => {
    const ir = workflowIR({
      jobs: [job('build', ['missing'])],
      dependencies: [{from: 'missing', to: 'build'}],
    });

    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]).toEqual({
        id: staticDiagnosticIds.unknownJobDependency,
        severity: 'error',
        message: 'Job "build" depends on unknown job "missing"',
        path: ['jobs', 'build', 'needs'],
      });
    }
  });

  test('reports unknown dependent jobs with stable diagnostic ID', () => {
    const ir = workflowIR({
      jobs: [job('build', [])],
      dependencies: [{from: 'build', to: 'missing'}],
    });

    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]).toEqual({
        id: staticDiagnosticIds.unknownDependentJob,
        severity: 'error',
        message: 'Dependency edge targets unknown job "missing"',
        path: ['dependencies', 0, 'to'],
      });
    }
  });

  test('reports normalized surface diagnostics with author-facing job names', () => {
    const document: SurfaceWorkflowDocument = {
      name: 'Test workflow',
      jobs: {
        'build main': {
          needs: 'ghost',
          steps: [{run: 'echo build'}],
        },
      },
    };
    const ir = normalizeSurfaceDocumentToWorkflowIR(document);

    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]).toEqual({
        id: staticDiagnosticIds.unknownJobDependency,
        severity: 'error',
        message: 'Job "build main" depends on unknown job "ghost"',
        path: ['jobs', 'build main', 'needs'],
      });
    }
  });

  test('reports self dependencies before cycle diagnostics', () => {
    const ir = workflowIR({
      jobs: [job('build', ['build'])],
      dependencies: [{from: 'build', to: 'build'}],
    });

    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]?.id).toBe(staticDiagnosticIds.selfJobDependency);
      expect(result.diagnostics[0]?.message).toBe('Job "build" depends on itself');
    }
  });

  test('reports cyclic dependencies with stable diagnostic ID', () => {
    const ir = workflowIR({
      jobs: [job('a', ['c']), job('b', ['a']), job('c', ['b'])],
      dependencies: [
        {from: 'a', to: 'b'},
        {from: 'b', to: 'c'},
        {from: 'c', to: 'a'},
      ],
    });

    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]?.id).toBe(staticDiagnosticIds.cyclicJobDependency);
      expect(result.diagnostics[0]?.message).toBe(
        'Circular dependency detected among jobs: a, b, c',
      );
      expect(result.diagnostics[0]?.path).toEqual(['jobs']);
    }
  });

  test('reports only the cyclic strongly connected component', () => {
    const ir = workflowIR({
      jobs: [job('a', ['b']), job('b', ['a']), job('c', ['b'])],
      dependencies: [
        {from: 'a', to: 'b'},
        {from: 'b', to: 'a'},
        {from: 'b', to: 'c'},
      ],
    });

    const result = validateWorkflowIRStaticSemantics(ir);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics[0]?.id).toBe(staticDiagnosticIds.cyclicJobDependency);
      expect(result.diagnostics[0]?.message).toBe('Circular dependency detected among jobs: a, b');
    }
  });
});

function workflowIR(overrides: Partial<WorkflowIR> = {}): WorkflowIR {
  return {
    id: 'test-workflow',
    name: 'Test workflow',
    triggers: [],
    runner: null,
    jobs: [job('build', [])],
    steps: [],
    dependencies: [],
    ...overrides,
  };
}

function job(id: string, dependencies: readonly string[], position = 0) {
  return {id, sourceName: id, position, dependencies, runner: null, steps: []};
}
