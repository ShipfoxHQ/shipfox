import type {WorkflowDocument, WorkflowDocumentJob} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

const UNAVAILABLE_CONTEXT_CODE = /^context-unavailable-at-(fill|predicate)-site$/;

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function workflowWithJob(job: WorkflowDocumentJob): WorkflowDocument {
  return {name: 'runner context', runner: 'ubuntu-latest', jobs: {build: job}};
}

function normalize(document: WorkflowDocument) {
  return normalizeWorkflowDocument(document, {agentValidationCatalog});
}

function issuesOf(document: WorkflowDocument) {
  try {
    normalize(document);
  } catch (error) {
    if (error instanceof InvalidWorkflowModelError) return error.issues;
    throw error;
  }
  return [];
}

describe('the runner context', () => {
  it('plans run, env, and step.if references at step dispatch', () => {
    const model = normalize(
      workflowWithJob({
        steps: [
          {
            if: interpolation('runner.arch == "arm64"'),
            run: `./install-${interpolation('runner.os')}.sh`,
            env: {TARGET: interpolation('runner.arch == "arm64" ? "aarch64" : "x86_64"')},
          },
        ],
      }),
    );

    expect(JSON.stringify(model.jobs[0]?.steps[0])).toContain('"fillTarget":"step-dispatch"');
  });

  it.each<[string, WorkflowDocumentJob]>([
    ['job.if', {if: interpolation('runner.os == "linux"'), steps: [{run: 'echo ok'}]}],
    ['job.runner', {runner: `linux-${interpolation('runner.arch')}`, steps: [{run: 'echo ok'}]}],
    [
      'job.container.image',
      {container: {image: `node:${interpolation('runner.arch')}`}, steps: [{run: 'echo ok'}]},
    ],
    ['job.outputs', {steps: [{run: 'echo ok'}], outputs: {arch: interpolation('runner.arch')}}],
  ])('rejects it in %s, which is not resolved at step dispatch', (_field, job) => {
    const issues = issuesOf(workflowWithJob(job));

    expect(issues).toEqual([
      expect.objectContaining({
        code: expect.stringMatching(UNAVAILABLE_CONTEXT_CODE),
        details: expect.objectContaining({unavailableRoots: ['runner']}),
      }),
    ]);
  });

  it('says the context is only available at step dispatch', () => {
    const issues = issuesOf(
      workflowWithJob({steps: [{run: 'echo ok'}], outputs: {arch: interpolation('runner.arch')}}),
    );

    expect(issues[0]?.message).toContain('"runner" is only available at step dispatch.');
  });

  it('type-checks runner fields', () => {
    const issues = issuesOf(
      workflowWithJob({steps: [{if: interpolation('runner.cpu == "arm64"'), run: 'echo ok'}]}),
    );

    expect(issues).toEqual([expect.objectContaining({path: ['jobs', 'build', 'steps', 0, 'if']})]);
  });
});

describe('hashFiles()', () => {
  it('plans a call in run and env as a runner-fill segment with its patterns', () => {
    const model = normalize(
      workflowWithJob({
        steps: [
          {
            run: `echo ${interpolation("hashFiles('package-lock.json')")}`,
            env: {KEY: `npm-${interpolation("hashFiles('**/package-lock.json', 'a.yaml')")}`},
          },
        ],
      }),
    );

    const step = JSON.stringify(model.jobs[0]?.steps[0]);
    expect(step).toContain(
      '"runnerCall":{"function":"hashFiles","patterns":["**/package-lock.json","a.yaml"]}',
    );
    expect(step).toContain(
      '"runnerCall":{"function":"hashFiles","patterns":["package-lock.json"]}',
    );
  });

  it.each([
    [
      'in step.if',
      {if: interpolation('hashFiles("x") != ""'), run: 'echo ok'},
      'hash-files-in-field',
    ],
    [
      'in a step name',
      {name: interpolation('hashFiles("x")'), run: 'echo ok'},
      'hash-files-in-field',
    ],
    [
      'in a larger expression',
      {env: {KEY: interpolation('"npm-" + hashFiles("x")')}, run: 'echo ok'},
      'hash-files-not-bare',
    ],
    [
      'with a non-literal pattern',
      {env: {KEY: interpolation('hashFiles(vars.LOCK)')}, run: 'echo ok'},
      'hash-files-argument-not-literal',
    ],
    [
      'with a pattern outside the workspace',
      {env: {KEY: interpolation('hashFiles("~/.npmrc")')}, run: 'echo ok'},
      'hash-files-pattern-outside-workspace',
    ],
  ] as const)('rejects a call %s', (_label, step, code) => {
    const issues = issuesOf(workflowWithJob({steps: [step]}));

    expect(issues).toEqual([expect.objectContaining({code})]);
  });

  it('rejects a call in a job container env value', () => {
    const issues = issuesOf(
      workflowWithJob({
        container: {image: 'node:22', env: {KEY: interpolation('hashFiles("x")')}},
        steps: [{run: 'echo ok'}],
      }),
    );

    expect(issues).toEqual([expect.objectContaining({code: 'hash-files-in-field'})]);
  });
});
