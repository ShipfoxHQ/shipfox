import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {WorkflowTemplateResolutionError} from '../resolver/errors.js';
import {freezeResolvedFieldAtSite} from './freeze.js';
import type {ResolvedField} from './resolved-field.js';

function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

describe('freezeResolvedFieldAtSite', () => {
  it('concatenates literals and filled deferred values in segment order', () => {
    const field: ResolvedField = {
      segments: [
        {kind: 'literal', value: 'run='},
        {
          kind: 'deferred',
          expression: expression('run.id'),
          roots: ['run'],
          fillTarget: 'run-creation',
        },
        {kind: 'literal', value: ',ok='},
        {kind: 'deferred', expression: expression('true'), roots: [], fillTarget: 'run-creation'},
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {run: {id: 42}},
    });

    expect(result).toEqual({
      value: 'run=42,ok=true',
      diagnostics: [],
      trace: [
        {
          expression: 'run.id',
          roots: ['run'],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: '42',
        },
        {
          expression: 'true',
          roots: [],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: 'true',
        },
      ],
    });
  });

  it('throws for fail-policy missing paths on known roots available at the site', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('run.missing'),
          roots: ['run'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'fail',
        site: 'run-creation',
        context: {run: {}},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('degrades missing paths under degrade policy', () => {
    const field: ResolvedField = {
      segments: [
        {kind: 'literal', value: 'event='},
        {
          kind: 'deferred',
          expression: expression('event.title'),
          roots: ['event'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'degrade',
      site: 'run-creation',
      context: {event: {}},
    });

    expect(result).toEqual({
      value: 'event=',
      diagnostics: [{reason: 'missing-path', expression: 'event.title', contextRoots: ['event']}],
      trace: [
        {
          expression: 'event.title',
          roots: ['event'],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: '',
          degraded: true,
        },
      ],
    });
  });

  it('still throws non-missing-path evaluation errors under degrade policy', () => {
    const field: ResolvedField = {
      segments: [
        {kind: 'deferred', expression: expression('1 / 0'), roots: [], fillTarget: 'run-creation'},
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'degrade',
        site: 'run-creation',
        context: {},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('degrades fail-policy missing paths when the segment has only unknown roots', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('typo_root.value'),
          roots: ['typo_root'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {},
    });

    expect(result).toEqual({
      value: '',
      diagnostics: [
        {reason: 'missing-path', expression: 'typo_root.value', contextRoots: ['typo_root']},
      ],
      trace: [
        {
          expression: 'typo_root.value',
          roots: ['typo_root'],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: '',
          degraded: true,
        },
      ],
    });
  });

  it('throws for fail-policy missing paths when over-included roots include a non-workflow root', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('{foo: event.ref}.foo'),
          roots: ['event', 'foo'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'fail',
        site: 'run-creation',
        context: {event: {}},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('throws for fail-policy missing paths on reserved server roots available at the site', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('steps.build.output'),
          roots: ['steps'],
          fillTarget: 'step-report',
        },
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'fail',
        site: 'step-report',
        context: {steps: {}},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('skips deferred-past-site segments without evaluating their expression', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('1 / 0 + execution.index'),
          roots: ['execution'],
          fillTarget: 'execution-creation',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {},
    });

    expect(result).toEqual({
      value: '',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: '1 / 0 + execution.index',
          contextRoots: ['execution'],
        },
      ],
      trace: [],
    });
  });

  it('skips runner-fill segments server-side', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('runner.os'),
          roots: ['runner'],
          fillTarget: 'runner-fill',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'job-resolution',
      context: {runner: {os: 'linux'}},
    });

    expect(result).toEqual({
      value: '',
      diagnostics: [{reason: 'missing-path', expression: 'runner.os', contextRoots: ['runner']}],
      trace: [],
    });
  });
});
