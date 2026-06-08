import type {WorkflowDocument} from '@shipfox/workflow-document';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

describe('normalizeWorkflowDocument', () => {
  it('normalizes a workflow document into WorkflowIR', () => {
    const document: WorkflowDocument = {
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
          steps: [{run: 'npm install'}, {name: 'build', run: 'npm run build'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: true,
      ir: {
        kind: 'workflow',
        name: 'simple build',
        triggers: [
          {
            id: 'main-push',
            sourceName: 'main_push',
            source: 'github',
            event: 'push',
            filter: {
              source: 'event.ref == "refs/heads/main"',
              expression: {
                kind: 'binary',
                op: '==',
                left: {kind: 'ref', path: ['event', 'ref']},
                right: {kind: 'string', value: 'refs/heads/main'},
              },
            },
          },
        ],
        jobs: [
          {
            id: 'build',
            sourceName: 'build',
            runner: [],
            dependencies: [],
            steps: [
              {
                id: 'build-step-1',
                kind: 'run',
                command: {kind: 'shell', value: 'npm install'},
                acceptance: {kind: 'default_run_exit_code'},
              },
              {
                id: 'build-build',
                sourceName: 'build',
                kind: 'run',
                command: {kind: 'shell', value: 'npm run build'},
                acceptance: {kind: 'default_run_exit_code'},
              },
            ],
          },
        ],
        dependencies: [],
      },
      diagnostics: [],
    });
  });

  it('applies top-level runner defaults to jobs without runner overrides', () => {
    const document: WorkflowDocument = {
      name: 'runner defaults',
      runner: ['ubuntu-latest', 'node-22'],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        test: {
          runner: 'ubuntu-latest',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.ir.jobs).toMatchObject([
      {id: 'build', runner: ['ubuntu-latest', 'node-22']},
      {id: 'test', runner: ['ubuntu-latest']},
    ]);
  });

  it('expands needs into job dependencies and explicit graph edges', () => {
    const document: WorkflowDocument = {
      name: 'graph',
      jobs: {
        'build app': {
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build app',
          steps: [{run: 'npm test'}],
        },
        deploy: {
          needs: ['build app', 'test'],
          steps: [{run: 'npm run deploy'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.ir.jobs.map((job) => ({id: job.id, dependencies: job.dependencies}))).toEqual([
      {id: 'build-app', dependencies: []},
      {id: 'test', dependencies: ['build-app']},
      {id: 'deploy', dependencies: ['build-app', 'test']},
    ]);
    expect(result.ir.dependencies).toEqual([
      {from: 'build-app', to: 'test'},
      {from: 'build-app', to: 'deploy'},
      {from: 'test', to: 'deploy'},
    ]);
  });

  it('deduplicates repeated needs before building graph edges', () => {
    const document: WorkflowDocument = {
      name: 'dedupe graph',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: ['build', 'build'],
          steps: [{run: 'npm test'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.ir.jobs).toMatchObject([
      {id: 'build', dependencies: []},
      {id: 'test', dependencies: ['build']},
    ]);
    expect(result.ir.dependencies).toEqual([{from: 'build', to: 'test'}]);
  });

  it('reports unknown dependencies', () => {
    const document: WorkflowDocument = {
      name: 'unknown dependency',
      jobs: {
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM101',
          severity: 'error',
          message: 'Job "test" depends on unknown job "build".',
          path: ['jobs', 'test', 'needs'],
          details: {job: 'test', dependency: 'build'},
        },
      ],
    });
  });

  it('reports self dependencies', () => {
    const document: WorkflowDocument = {
      name: 'self dependency',
      jobs: {
        test: {
          needs: 'test',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM102',
          severity: 'error',
          message: 'Job "test" depends on itself.',
          path: ['jobs', 'test', 'needs'],
          details: {job: 'test'},
        },
      ],
    });
  });

  it('reports dependency cycles', () => {
    const document: WorkflowDocument = {
      name: 'cycle',
      jobs: {
        build: {
          needs: 'test',
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM103',
          severity: 'error',
          message: 'Circular dependency detected among jobs: build, test.',
          path: ['jobs'],
          details: {cycleSourceNames: ['build', 'test'], cycleJobIds: ['build', 'test']},
        },
      ],
    });
  });

  it('reports stable job id collisions', () => {
    const document: WorkflowDocument = {
      name: 'collision',
      jobs: {
        'build app': {
          steps: [{run: 'npm run build'}],
        },
        'build-app': {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM104',
          severity: 'error',
          message:
            'Job names "build app" and "build-app" resolve to the same stable id "build-app".',
          path: ['jobs', 'build-app'],
          details: {id: 'build-app', sourceNames: ['build app', 'build-app']},
        },
      ],
    });
  });

  it('reports stable trigger id collisions', () => {
    const document: WorkflowDocument = {
      name: 'trigger collision',
      triggers: {
        main_push: {source: 'github', event: 'push'},
        'main push': {source: 'github', event: 'push'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM105',
          severity: 'error',
          message:
            'Trigger names "main_push" and "main push" resolve to the same stable id "main-push".',
          path: ['triggers', 'main push'],
          details: {id: 'main-push', sourceNames: ['main_push', 'main push']},
        },
      ],
    });
  });

  it('reports stable step id collisions inside a job', () => {
    const document: WorkflowDocument = {
      name: 'step collision',
      jobs: {
        build: {
          steps: [{run: 'npm install'}, {name: 'step 1', run: 'npm test'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM106',
          severity: 'error',
          message: 'Steps 0 and 1 in job "build" resolve to the same stable id "build-step-1".',
          path: ['jobs', 'build', 'steps', 1],
          details: {id: 'build-step-1', indexes: [0, 1]},
        },
      ],
    });
  });

  it('reports invalid trigger filter expressions', () => {
    const document: WorkflowDocument = {
      name: 'bad filter',
      triggers: {
        main: {
          source: 'github',
          event: 'push',
          filter: 'step.output.pass == true',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM201',
          severity: 'error',
          message: 'Trigger "main" has an invalid filter expression.',
          path: ['triggers', 'main', 'filter'],
          details: {
            expressionDiagnostics: [
              {
                code: 'WFE003',
                severity: 'error',
                message: 'Reference root "step" is not supported in this expression.',
                position: 0,
                details: {root: 'step', allowedRoots: ['event']},
              },
            ],
          },
        },
      ],
    });
  });

  it('collects independent diagnostics in one normalization pass', () => {
    const document: WorkflowDocument = {
      name: 'many errors',
      triggers: {
        main: {
          source: 'github',
          event: 'push',
          filter: 'step.output.pass == true',
        },
      },
      jobs: {
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['WFM201', 'WFM101']);
  });

  it('maps trigger with values to IR inputs', () => {
    const document: WorkflowDocument = {
      name: 'inputs',
      triggers: {
        dispatch: {
          source: 'github',
          event: 'workflow_dispatch',
          with: {environment: 'production'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.ir.triggers).toEqual([
      {
        id: 'dispatch',
        sourceName: 'dispatch',
        source: 'github',
        event: 'workflow_dispatch',
        inputs: {environment: 'production'},
      },
    ]);
  });

  it('allows a single manual trigger', () => {
    const document: WorkflowDocument = {
      name: 'manual trigger',
      triggers: {
        manual: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.ir.triggers).toMatchObject([{id: 'manual', source: 'manual', event: 'fire'}]);
  });

  it('reports multiple manual triggers as a semantic rule', () => {
    const document: WorkflowDocument = {
      name: 'manual triggers',
      triggers: {
        one: {source: 'manual', event: 'fire'},
        two: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = normalizeWorkflowDocument(document);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFM301',
          severity: 'error',
          message: 'A workflow may declare at most one manual trigger; found 2: one, two.',
          path: ['triggers'],
          details: {manualTriggerNames: ['one', 'two']},
        },
      ],
    });
  });
});
