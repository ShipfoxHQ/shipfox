import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {fillResolvedFieldAtSite} from './fill.js';
import type {ResolvedField} from './resolved-field.js';

function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

describe('fillResolvedFieldAtSite', () => {
  it('leaves a fully literal field unchanged', () => {
    const field: ResolvedField = {segments: [{kind: 'literal', value: 'deploy main'}]};

    const result = fillResolvedFieldAtSite({field, site: 'run-creation', context: {}});

    expect(result).toEqual(field);
  });

  it('fills deferred server segments whose targets are at or before the current site', () => {
    const field: ResolvedField = {
      segments: [
        {kind: 'literal', value: 'run:'},
        {
          kind: 'deferred',
          expression: expression('run.id'),
          roots: ['run'],
          fillTarget: 'run-creation',
        },
        {kind: 'literal', value: ':step:'},
        {
          kind: 'deferred',
          expression: expression('step.status'),
          roots: ['step'],
          fillTarget: 'step-report',
        },
        {kind: 'literal', value: ':runner:'},
        {
          kind: 'deferred',
          expression: expression('runner.os'),
          roots: ['runner'],
          fillTarget: 'runner-fill',
        },
      ],
    };

    const result = fillResolvedFieldAtSite({
      field,
      site: 'job-activation',
      context: {run: {id: 'run-123'}, step: {status: 'succeeded'}, runner: {os: 'linux'}},
    });

    expect(result).toEqual({
      segments: [
        {kind: 'literal', value: 'run:'},
        {kind: 'literal', value: 'run-123'},
        {kind: 'literal', value: ':step:'},
        {
          kind: 'deferred',
          expression: expression('step.status'),
          roots: ['step'],
          fillTarget: 'step-report',
        },
        {kind: 'literal', value: ':runner:'},
        {
          kind: 'deferred',
          expression: expression('runner.os'),
          roots: ['runner'],
          fillTarget: 'runner-fill',
        },
      ],
    });
  });

  it('fills an earlier target when the orchestration reaches a later site first', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('run.id'),
          roots: ['run'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const result = fillResolvedFieldAtSite({
      field,
      site: 'job-activation',
      context: {run: {id: 'run-123'}},
    });

    expect(result).toEqual({segments: [{kind: 'literal', value: 'run-123'}]});
  });

  it('narrows across multiple server sites to a frozen field', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('run.id'),
          roots: ['run'],
          fillTarget: 'run-creation',
        },
        {kind: 'literal', value: ':'},
        {
          kind: 'deferred',
          expression: expression('step.status'),
          roots: ['step'],
          fillTarget: 'step-report',
        },
      ],
    };

    const atRunCreation = fillResolvedFieldAtSite({
      field,
      site: 'run-creation',
      context: {run: {id: 'run-123'}},
    });
    const atStepReport = fillResolvedFieldAtSite({
      field: atRunCreation,
      site: 'step-report',
      context: {run: {id: 'run-123'}, step: {status: 'succeeded'}},
    });
    const repeated = fillResolvedFieldAtSite({
      field: atStepReport,
      site: 'step-report',
      context: {run: {id: 'changed'}, step: {status: 'failed'}},
    });

    expect(atStepReport).toEqual({
      segments: [
        {kind: 'literal', value: 'run-123'},
        {kind: 'literal', value: ':'},
        {kind: 'literal', value: 'succeeded'},
      ],
    });
    expect(repeated).toEqual(atStepReport);
  });
});
