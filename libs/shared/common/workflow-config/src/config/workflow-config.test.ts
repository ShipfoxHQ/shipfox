import {workflowConfigSchema} from './workflow-config.js';

describe('workflowConfigSchema', () => {
  it('accepts a valid minimal workflow config', () => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it.each([
    ['a string runner', 'ubuntu-latest'],
    ['a runner label array', ['ubuntu-latest', 'node-22']],
  ])('accepts top-level runner as %s', (_label, runner) => {
    const config = {
      name: 'simple build',
      runner,
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it.each([
    ['a string runner', 'ubuntu-latest'],
    ['a runner label array', ['ubuntu-latest', 'node-22']],
  ])('accepts job runner as %s', (_label, runner) => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          runner,
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it.each([
    ['a string dependency', 'build'],
    ['a dependency array', ['install', 'build']],
  ])('accepts job needs as %s', (_label, needs) => {
    const config = {
      name: 'simple build',
      jobs: {
        test: {
          needs,
          steps: [{run: 'npm test'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('keeps trigger filters as strings', () => {
    const config = {
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

    const result = workflowConfigSchema.parse(config);

    expect(result.triggers?.main_push?.filter).toBe('event.ref == "refs/heads/main"');
  });

  it.each([
    ['a trigger event string', {source: 'github', event: 'push'}],
    ['a trigger on string', {source: 'github', on: 'push'}],
    ['a trigger on array', {source: 'github', on: ['push', 'pull_request']}],
  ])('accepts %s', (_label, trigger) => {
    const config = {
      name: 'simple build',
      triggers: {github: trigger},
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('rejects a workflow config without a name', () => {
    const config = {
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects a workflow config without jobs', () => {
    const config = {
      name: 'simple build',
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects an empty jobs map', () => {
    const config = {
      name: 'simple build',
      jobs: {},
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects an empty triggers map when triggers are present', () => {
    const config = {
      name: 'simple build',
      triggers: {},
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects a job without steps', () => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {},
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects an empty steps array', () => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects a step without a supported action', () => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{name: 'build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it.each([
    ['missing event and on', {source: 'github'}],
    ['both event and on', {source: 'github', event: 'push', on: 'pull_request'}],
  ])('rejects a trigger with %s', (_label, trigger) => {
    const config = {
      name: 'simple build',
      triggers: {github: trigger},
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

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
  ])('rejects %s', (_label, config) => {
    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });
});
