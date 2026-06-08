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

  it('keeps gate success_if as a string', () => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [
            {
              run: 'npm run build',
              gate: {success_if: 'exit_code == 0'},
            },
          ],
        },
      },
    };

    const result = workflowConfigSchema.parse(config);

    expect(result.jobs.build?.steps[0]?.gate?.success_if).toBe('exit_code == 0');
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

  it.each([
    ['restart_from', {restart_from: 'build'}],
    ['output', {output: 'Build failed'}],
    ['restart_from and output', {restart_from: 'build', output: 'Build failed'}],
  ])('accepts gate on_failure with %s', (_label, onFailure) => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {on_failure: onFailure}}],
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
          steps: [{id: 'build'}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects an empty gate', () => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {}}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects an empty gate on_failure block', () => {
    const config = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {on_failure: {}}}],
        },
      },
    };

    const result = workflowConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });
});
