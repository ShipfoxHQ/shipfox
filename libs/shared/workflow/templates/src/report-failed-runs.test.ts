import {createWorkflowExpression, evaluateWorkflowExpression} from '@shipfox/expression';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {composeTemplate} from './composer.js';
import {loadShippedTemplates} from './loader.js';

const template = loadShippedTemplates().find((entry) => entry.manifest.id === 'report-failed-runs');
if (template === undefined) throw new Error('Missing failed run report template');
const composed = composeTemplate(template, {notify: 'slack'});
const optionMarker = /^\s*# option:(\w+)=(\w+) (begin|end)$/;
const interpolationOpen = /^\$\{\{/u;
const interpolationClose = /\}\}$/u;
const interpolationSegment = /\$\{\{([\s\S]*?)\}\}/gu;
const longLogExcerpt = /^….*Error: the last line$/su;
const defaults = {
  scope: 'project',
  workflow_filter: 'all',
  include_cancelled: 'off',
  diagnosis: 'off',
};
const projectId = 'replace-with-project-id';

type Selections = typeof defaults;

function workflow(selections: Partial<Selections> = {}) {
  const selected = {...defaults, ...selections};
  const open: boolean[] = [];
  const yaml = composed
    .split('\n')
    .filter((line) => {
      const marker = optionMarker.exec(line);
      if (marker === null) return open.every(Boolean);
      if (marker[3] === 'begin') {
        open.push(selected[marker[1] as keyof Selections] === marker[2]);
      } else {
        open.pop();
      }
      return false;
    })
    .join('\n');
  return parseWorkflowDocument(parseYaml(yaml));
}

function evaluate(source: string, context: Record<string, unknown>): unknown {
  const expression = source
    .trim()
    .replace(interpolationOpen, '')
    .replace(interpolationClose, '')
    .trim();
  return evaluateWorkflowExpression(
    createWorkflowExpression({source: expression, check: {mode: 'syntax'}}),
    context,
  );
}

function completedEvent(
  run: Record<string, unknown> = {},
  overrides: {project?: Record<string, unknown>; workflow?: Record<string, unknown>} = {},
) {
  return {
    project: {id: projectId, name: 'api', ...overrides.project},
    workflow: {
      id: 'deploy-workflow',
      name: 'Deploy',
      path: '.shipfox/workflows/deploy.yml',
      ...overrides.workflow,
    },
    run: {
      id: '0198a100-0000-7000-8000-000000000003',
      number: 7,
      attempt: 1,
      origin: 'synced',
      status: 'failed',
      status_reason: 'job_failed',
      ...run,
    },
  };
}

function matches(event: ReturnType<typeof completedEvent>, selections?: Partial<Selections>) {
  const filter = workflow(selections).triggers?.run_completed?.filter;
  if (filter === undefined) throw new Error('Missing trigger filter');
  return evaluate(filter, {event});
}

function reportStep(key: string) {
  const step = workflow().jobs.report?.steps.find((entry) => entry.key === key);
  if (step === undefined) throw new Error(`Missing ${key} step`);
  return step as {outputs?: Record<string, string>; with?: Record<string, string>};
}

function stepOutput(key: string, output: string) {
  const value = reportStep(key).outputs?.[output];
  if (value === undefined) throw new Error(`Missing ${key}.${output}`);
  return value;
}

function message(event: ReturnType<typeof completedEvent>, steps: Record<string, unknown>) {
  const source = reportStep('notify').with?.message;
  if (source === undefined) throw new Error('Missing notify message');
  return source.replace(interpolationSegment, (_segment, expression: string) =>
    String(evaluate(expression, {event, steps})),
  );
}

function workflowRun(overrides: {
  status?: string;
  started?: boolean;
  jobs?: readonly Record<string, unknown>[];
}) {
  return {
    run: {
      status: overrides.status ?? 'failed',
      has_started_job_execution: overrides.started ?? true,
    },
    jobs: overrides.jobs ?? [],
  };
}

function failedJob(reason: string, steps: readonly Record<string, unknown>[] = []) {
  return {
    key: 'build',
    status: 'failed',
    status_reason: reason,
    selected_execution: {steps: {items: steps}},
  };
}

describe('failed run report', () => {
  it.each([
    {},
    {scope: 'workspace'},
    {workflow_filter: 'selected'},
    {include_cancelled: 'on'},
    {diagnosis: 'agent'},
  ])('parses the %o variant', (selections) => {
    expect(workflow(selections).triggers?.run_completed).toMatchObject({
      source: 'shipfox',
      event: 'run.completed',
    });
  });

  it.each([
    ['a failed synced run of the project', completedEvent(), true],
    ['a succeeded run', completedEvent({status: 'succeeded', status_reason: null}), false],
    [
      'a cancelled run',
      completedEvent({status: 'cancelled', status_reason: 'user_cancelled'}),
      false,
    ],
    ['a dev run', completedEvent({origin: 'dev'}), false],
    ['another project', completedEvent({}, {project: {id: 'other-project'}}), false],
  ])('reports %s: %s', (_name, event, expected) => {
    expect(matches(event)).toBe(expected);
  });

  it('reports other projects when the scope is the workspace', () => {
    const event = completedEvent({}, {project: {id: 'other-project'}});

    expect(matches(event, {scope: 'workspace'})).toBe(true);
  });

  it('reports only the listed workflow files when selected', () => {
    const listed = completedEvent(
      {},
      {workflow: {path: '.shipfox/workflows/replace-with-workflow.yml'}},
    );

    expect(matches(listed, {workflow_filter: 'selected'})).toBe(true);
    expect(matches(completedEvent(), {workflow_filter: 'selected'})).toBe(false);
  });

  it('adds cancelled runs except those replaced by a newer run', () => {
    const cancelled = completedEvent({status: 'cancelled', status_reason: 'user_cancelled'});
    const superseded = completedEvent({
      status: 'cancelled',
      status_reason: 'concurrency_superseded',
    });

    expect(matches(cancelled, {include_cancelled: 'on'})).toBe(true);
    expect(matches(superseded, {include_cancelled: 'on'})).toBe(false);
  });

  it('skips runs of the report workflow itself', () => {
    const condition = workflow().jobs.report?.if;
    if (condition === undefined) throw new Error('Missing report condition');

    expect(evaluate(condition, {event: completedEvent(), workflow: {id: 'deploy-workflow'}})).toBe(
      false,
    );
    expect(evaluate(condition, {event: completedEvent(), workflow: {id: 'report-workflow'}})).toBe(
      true,
    );
  });

  it('suggests reading the admission error when no job started', () => {
    const next = evaluate(stepOutput('detail', 'next'), {
      result: workflowRun({started: false, jobs: [failedJob('unknown')]}),
    });

    expect(next).toContain('No job started');
  });

  it.each([
    ['runner_lost', 'runner stopped responding'],
    ['timed_out', 'time limit'],
    ['condition_errored', 'workflow expression'],
    ['step_failed', "failed step's log"],
  ])('suggests a next step for %s', (reason, expected) => {
    const next = evaluate(stepOutput('detail', 'next'), {
      result: workflowRun({jobs: [failedJob(reason)]}),
    });

    expect(next).toContain(expected);
  });

  it('names failed jobs and steps with the first step error', () => {
    const result = workflowRun({
      jobs: [
        {key: 'lint', status: 'succeeded', status_reason: null, selected_execution: null},
        failedJob('step_failed', [
          {name: 'Install', status: 'succeeded', error: null},
          {name: 'Run tests', status: 'failed', error: {message: 'Process exited with code 1'}},
        ]),
        {key: 'deploy', status: 'failed', status_reason: 'runner_lost', selected_execution: null},
      ],
    });

    const failed = evaluate(stepOutput('detail', 'failed'), {result});
    const error = evaluate(stepOutput('detail', 'error'), {result});

    expect(failed).toBe('`build` › `Run tests`, `deploy` (runner_lost)');
    expect(error).toBe('Process exited with code 1');
  });

  it('keeps the end of a long log', () => {
    const content = `${'x'.repeat(5000)}\nError: the last line`;

    const excerpt = evaluate(stepOutput('logs', 'excerpt'), {result: {sections: [{content}]}});

    expect(excerpt).toMatch(longLogExcerpt);
    expect((excerpt as string).length).toBe(801);
  });

  it('links the run and names its attempt and project', () => {
    const event = completedEvent({attempt: 2});

    const text = message(event, {
      detail: {outputs: {failed: '`build` › `Run tests`', error: '', next: 'Rerun.'}},
      logs: {outputs: {excerpt: 'Error: boom'}},
    });

    expect(text).toBe(
      '**[Deploy #7](https://app.shipfox.io/runs/0198a100-0000-7000-8000-000000000003)** failed on attempt 2 in api\nFailed: `build` › `Run tests`\n```\nError: boom\n```\nNext: Rerun.',
    );
  });

  it('keeps the report under the Slack message limit', () => {
    const event = completedEvent(
      {},
      {workflow: {name: 'W'.repeat(5000)}, project: {name: 'P'.repeat(5000)}},
    );

    const text = message(event, {
      detail: {outputs: {failed: 'f'.repeat(5000), error: 'e'.repeat(2048), next: 'Rerun.'}},
      logs: {outputs: {excerpt: `…${'l'.repeat(800)}`}},
    });

    expect(text.length).toBeLessThan(2_000);
  });
});
