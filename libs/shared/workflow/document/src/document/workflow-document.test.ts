import {workflowDocumentSchema} from './workflow-document.js';

describe('workflowDocumentSchema', () => {
  it('accepts a valid minimal workflow document', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    [
      'top-level string runner',
      {name: 'simple build', runner: 'ubuntu-latest', jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'top-level runner array',
      {
        name: 'simple build',
        runner: ['ubuntu-latest', 'node-22'],
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'job string runner',
      {
        name: 'simple build',
        jobs: {build: {runner: 'ubuntu-latest', steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'job runner array',
      {
        name: 'simple build',
        jobs: {build: {runner: ['ubuntu-latest', 'node-22'], steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'string dependency',
      {name: 'simple build', jobs: {build: {needs: 'install', steps: [{run: 'npm test'}]}}},
    ],
    [
      'dependency array',
      {
        name: 'simple build',
        jobs: {build: {needs: ['install', 'lint'], steps: [{run: 'npm test'}]}},
      },
    ],
  ])('accepts %s shorthand', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it('keeps trigger filters as strings', () => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {
        main_push: {
          source: 'github',
          event: 'push',
          filter: 'event.ref == "refs/heads/main"',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.parse(workflowDocument);

    expect(result.triggers?.main_push?.filter).toBe('event.ref == "refs/heads/main"');
  });

  it('accepts agent steps with gates', () => {
    const workflowDocument = {
      name: 'review',
      jobs: {
        review: {
          steps: [
            {name: 'producer', run: 'npm run build'},
            {
              agent: 'reviewer',
              prompt: '/review',
              output_schema: {
                review: 'string',
                pass: 'boolean',
              },
              gate: {
                success_if: 'step.output.pass == true',
                on_failure: {
                  restart_from: 'producer',
                  output: `Agent rejected the PR \${{ step.output.review }}`,
                },
              },
              session: {
                persistent: false,
              },
            },
          ],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    ['missing required top-level fields', {}],
    ['empty jobs map', {name: 'simple build', jobs: {}}],
    [
      'empty triggers map',
      {name: 'simple build', triggers: {}, jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    ['empty steps array', {name: 'simple build', jobs: {build: {steps: []}}}],
    [
      'unsupported trigger on field',
      {
        name: 'simple build',
        triggers: {github: {source: 'github', event: 'push', on: 'pull_request'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'unknown fields',
      {name: 'simple build', jobs: {build: {steps: [{run: 'npm test', shell: 'bash'}]}}},
    ],
  ])('rejects %s', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });
});
