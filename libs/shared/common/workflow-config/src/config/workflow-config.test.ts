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
    ['a trigger event string', 'push'],
    ['a trigger on string', 'push'],
    ['a trigger on array', ['push', 'pull_request']],
  ])('accepts %s', (_label, eventOrOn) => {
    const trigger =
      typeof eventOrOn === 'string'
        ? {source: 'github', event: eventOrOn}
        : {source: 'github', on: eventOrOn};
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
});
