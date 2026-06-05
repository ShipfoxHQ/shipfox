import type {SurfaceWorkflowDocument} from '#core/surface/surface-workflow-document.js';
import {normalizeSurfaceDocumentToWorkflowIR} from './normalize-surface-document.js';

describe('normalizeSurfaceDocumentToWorkflowIR', () => {
  test('normalizes maps into deterministic trigger, job, and edge order', () => {
    const document = surfaceDocument({
      triggers: {
        on_push: {source: 'github', event: 'push', on: ['main'], filter: 'changed("src/**")'},
        manual: {source: 'manual', event: 'fire', with: {reason: 'debug'}},
      },
      runner: 'linux',
      jobs: {
        deploy: {needs: ['test', 'build'], runner: ['linux', 'deploy'], steps: [{run: 'deploy'}]},
        build: {steps: [{run: 'build'}]},
        test: {needs: 'build', steps: [{run: 'test'}]},
      },
    });

    const ir = normalizeSurfaceDocumentToWorkflowIR(document);

    expect(ir).toMatchObject({
      id: 'test-workflow',
      name: 'Test Workflow',
      runner: ['linux'],
      triggers: [
        {
          id: 'manual',
          source: 'manual',
          event: 'fire',
          on: null,
          with: {reason: 'debug'},
          filter: null,
        },
        {
          id: 'on-push',
          source: 'github',
          event: 'push',
          on: ['main'],
          with: null,
          filter: 'changed("src/**")',
        },
      ],
      jobs: [
        {id: 'build', sourceName: 'build', dependencies: [], runner: null, steps: ['build.build']},
        {
          id: 'deploy',
          sourceName: 'deploy',
          dependencies: ['build', 'test'],
          runner: ['linux', 'deploy'],
        },
        {
          id: 'test',
          sourceName: 'test',
          dependencies: ['build'],
          runner: null,
          steps: ['test.test'],
        },
      ],
      dependencies: [
        {from: 'build', to: 'deploy'},
        {from: 'build', to: 'test'},
        {from: 'test', to: 'deploy'},
      ],
    });
  });

  test('generates stable collision-safe run step IDs', () => {
    const document = surfaceDocument({
      jobs: {
        build: {
          steps: [
            {name: 'Install deps', run: 'pnpm install'},
            {run: 'pnpm install'},
            {run: 'pnpm install'},
            {name: 'Install deps', run: 'echo again'},
          ],
        },
      },
    });

    const first = normalizeSurfaceDocumentToWorkflowIR(document);
    const second = normalizeSurfaceDocumentToWorkflowIR(document);

    expect(first.jobs[0]?.steps).toEqual([
      'build.install-deps',
      'build.pnpm-install',
      'build.pnpm-install-2',
      'build.install-deps-2',
    ]);
    expect(first.steps[0]?.name).toBe('Install deps');
    expect(second.jobs[0]?.steps).toEqual(first.jobs[0]?.steps);
  });

  test('generates collision-safe job and trigger IDs from surface map names', () => {
    const document = surfaceDocument({
      triggers: {
        'on push': {source: 'github', event: 'push'},
        on_push: {source: 'github', event: 'push'},
      },
      jobs: {
        'build main': {steps: [{run: 'echo space'}]},
        build_main: {needs: 'build main', steps: [{run: 'echo underscore'}]},
      },
    });

    const ir = normalizeSurfaceDocumentToWorkflowIR(document);

    expect(ir.triggers.map((trigger) => trigger.id)).toEqual(['on-push', 'on-push-2']);
    expect(ir.jobs.map((job) => ({id: job.id, sourceName: job.sourceName}))).toEqual([
      {id: 'build-main', sourceName: 'build main'},
      {id: 'build-main-2', sourceName: 'build_main'},
    ]);
    expect(ir.dependencies).toEqual([{from: 'build-main', to: 'build-main-2'}]);
  });

  test('preserves unresolved dependency references for static semantics', () => {
    const document = surfaceDocument({
      jobs: {
        deploy: {steps: [{run: 'deploy'}]},
        test: {needs: ['Deploy', 'missing job'], steps: [{run: 'test'}]},
      },
    });

    const ir = normalizeSurfaceDocumentToWorkflowIR(document);

    expect(ir.jobs[1]?.dependencies).toEqual(['Deploy', 'missing job']);
    expect(ir.dependencies).toEqual([
      {from: 'Deploy', to: 'test'},
      {from: 'missing job', to: 'test'},
    ]);
  });

  test('documents empty-slug fallback IDs and absent optional collections', () => {
    const document = surfaceDocument({
      name: '!!!',
      jobs: {
        '---': {
          steps: [{name: '***', run: 'echo symbols'}],
        },
      },
    });

    const ir = normalizeSurfaceDocumentToWorkflowIR(document);

    expect(ir.id).toBe('item');
    expect(ir.triggers).toEqual([]);
    expect(ir.runner).toBeNull();
    expect(ir.jobs[0]?.id).toBe('item');
    expect(ir.jobs[0]?.runner).toBeNull();
    expect(ir.jobs[0]?.steps).toEqual(['item.item']);
  });

  test('normalizes run steps with typed default acceptance policy', () => {
    const document = surfaceDocument({
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    });

    const ir = normalizeSurfaceDocumentToWorkflowIR(document);

    expect(ir.steps[0]).toEqual({
      kind: 'run',
      id: 'build.npm-run-build',
      jobId: 'build',
      name: null,
      command: {kind: 'shell', value: 'npm run build'},
      acceptance: {
        kind: 'default_run_exit_code',
        successIf: {
          kind: 'binary',
          op: '==',
          left: {kind: 'ref', path: ['output', 'exit_code']},
          right: {kind: 'int', value: 0},
        },
      },
    });
  });
});

function surfaceDocument(
  overrides: Partial<SurfaceWorkflowDocument> = {},
): SurfaceWorkflowDocument {
  return {
    name: 'Test Workflow',
    jobs: {
      build: {
        steps: [{run: 'echo hello'}],
      },
    },
    ...overrides,
  };
}
