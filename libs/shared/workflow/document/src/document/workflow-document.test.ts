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
    ['a string runner', 'ubuntu-latest'],
    ['a runner label array', ['ubuntu-latest', 'node-22']],
  ])('accepts top-level runner as %s', (_label, runner) => {
    const workflowDocument = {
      name: 'simple build',
      runner,
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
    ['a string runner', 'ubuntu-latest'],
    ['a runner label array', ['ubuntu-latest', 'node-22']],
  ])('accepts job runner as %s', (_label, runner) => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          runner,
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    ['a string dependency', 'build'],
    ['a dependency array', ['install', 'build']],
  ])('accepts job needs as %s', (_label, needs) => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        test: {
          needs,
          steps: [{run: 'npm test'}],
        },
      },
    };

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

  it('accepts a trigger event string', () => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {github: {source: 'github', event: 'push'}},
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it('rejects a workflow document without a name', () => {
    const workflowDocument = {
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it('rejects a workflow document without jobs', () => {
    const workflowDocument = {
      name: 'simple build',
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it('rejects an empty jobs map', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {},
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it('rejects an empty triggers map when triggers are present', () => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {},
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it('rejects a job without steps', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {},
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it('rejects an empty steps array', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it('rejects a step without a supported action', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{name: 'build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it.each([
    ['a missing event', {source: 'github'}],
    ['an unsupported on string', {source: 'github', on: 'push'}],
    ['an unsupported on array', {source: 'github', on: ['push', 'pull_request']}],
    ['an unsupported on field with event', {source: 'github', event: 'push', on: 'pull_request'}],
  ])('rejects a trigger with %s', (_label, trigger) => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {github: trigger},
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it.each([
    [
      'an unknown top-level key',
      {name: 'simple build', jobz: {}, jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'an unknown trigger key',
      {
        name: 'simple build',
        triggers: {github: {source: 'github', event: 'push', typo: true}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'an unknown job key',
      {name: 'simple build', jobs: {build: {timeout: 10, steps: [{run: 'npm test'}]}}},
    ],
    [
      'an unknown step key',
      {name: 'simple build', jobs: {build: {steps: [{run: 'npm test', shell: 'bash'}]}}},
    ],
  ])('rejects %s', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });
});
