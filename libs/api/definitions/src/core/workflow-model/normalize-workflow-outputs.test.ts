import type {WorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function normalize(document: Omit<WorkflowDocument, 'jobs'> & Partial<WorkflowDocument>) {
  return normalizeWorkflowDocument(
    {
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              key: 'pkg',
              run: 'npm pack',
              outputs: {count: {type: 'number'}, version: {type: 'string'}},
            },
          ],
          outputs: {
            count: interpolation('steps.pkg.outputs.count'),
            version: interpolation('steps.pkg.outputs.version'),
          },
        },
        lint: {steps: [{run: 'npm run lint'}]},
      },
      ...document,
    },
    {agentValidationCatalog},
  );
}

function expectInvalid(document: Parameters<typeof normalize>[0]): InvalidWorkflowModelError {
  try {
    normalize(document);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidWorkflowModelError);
    return error as InvalidWorkflowModelError;
  }
  return expect.fail('Expected InvalidWorkflowModelError');
}

describe('normalizeWorkflowOutputs', () => {
  it('leaves outputs unset when the document declares none', () => {
    const model = normalize({name: 'no outputs'});

    expect(model).not.toHaveProperty('outputs');
    expect(model).not.toHaveProperty('outputTypes');
  });

  it('normalizes outputs typed against the jobs overlay', () => {
    const model = normalize({
      name: 'outputs',
      outputs: {
        count: interpolation('jobs.build.outputs.count'),
        label: `v${interpolation('jobs.build.outputs.version')}-${interpolation('run.number')}`,
        channel: 'stable',
      },
    });

    expect(model.outputTypes).toEqual({count: 'double', label: 'string', channel: 'string'});
    expect(model.outputs?.count).toEqual([
      {
        kind: 'deferred',
        expression: expect.objectContaining({
          source: 'jobs.build.outputs.count',
          check: 'typed',
          resultType: 'double',
        }),
        roots: ['jobs'],
        fillTarget: 'job-resolution',
      },
    ]);
    expect(model.outputs?.channel).toEqual([{kind: 'literal', value: 'stable'}]);
  });

  it('accepts every documented root', () => {
    const model = normalize({
      name: 'roots',
      outputs: {
        summary: [
          'jobs.build.status',
          'inputs.target',
          'vars.REGION',
          'workflow.name',
          'run.id',
          'trigger.source',
          'event.ref',
        ]
          .map(interpolation)
          .join(' '),
      },
    });

    expect(model.outputs?.summary).toBeDefined();
  });

  it('rejects a reference to an undeclared job output', () => {
    const error = expectInvalid({
      name: 'undeclared',
      outputs: {missing: interpolation('jobs.build.outputs.missing')},
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['outputs', 'missing'],
      }),
    ]);
  });

  it('rejects an output of a job that declares none', () => {
    const error = expectInvalid({
      name: 'no job outputs',
      outputs: {result: interpolation('jobs.lint.outputs.result')},
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['outputs', 'result'],
      }),
    ]);
  });

  it('rejects a reference to an unknown job', () => {
    const error = expectInvalid({
      name: 'unknown job',
      outputs: {version: interpolation('jobs.deploy.outputs.version')},
    });

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-expression',
        path: ['outputs', 'version'],
      }),
    ]);
  });

  it.each([
    'steps.pkg.outputs.count',
    'needs[0].key',
    'secrets.TOKEN',
  ])('rejects the %s context', (source) => {
    const error = expectInvalid({name: 'bad root', outputs: {value: interpolation(source)}});

    expect(error.issues).toEqual([expect.objectContaining({path: ['outputs', 'value']})]);
  });
});
