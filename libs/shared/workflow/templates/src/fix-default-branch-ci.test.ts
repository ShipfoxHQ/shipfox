import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkflowEnvironment} from '@shipfox/expression';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {composeTemplate} from './composer.js';
import {loadShippedTemplates} from './loader.js';

type ReportOutcomes = 'needs_person' | 'pull_requests' | 'both';
type YamlRecord = Record<string, unknown>;

const template = loadShippedTemplates().find((entry) => entry.id === 'fix-default-branch-ci');
if (template === undefined) throw new Error('Missing default-branch CI template');
const reportMarker = /^\s*# option:report_outcomes=([\w,]+) (begin|end)$/;
const expressionPattern = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/;
const interpolationPattern = /\$\{\{\s*([\s\S]*?)\s*\}\}/g;
const environment = createWorkflowEnvironment();
const roots: string[] = [];

function render(report: boolean, outcomes: ReportOutcomes = 'needs_person'): string {
  if (template === undefined) throw new Error('Missing default-branch CI template');
  const composed = composeTemplate(
    template,
    report ? {source: 'github', report: 'slack'} : {source: 'github'},
  );
  let selected = true;
  return composed
    .split('\n')
    .filter((line) => {
      const marker = reportMarker.exec(line);
      if (marker !== null) {
        selected = marker[2] === 'end' || (marker[1] ?? '').split(',').includes(outcomes);
        return false;
      }
      return selected;
    })
    .join('\n');
}

function workflow(report = false, outcomes: ReportOutcomes = 'needs_person'): YamlRecord {
  const yaml = render(report, outcomes);
  parseWorkflowDocument(parseYaml(yaml));
  return parseYaml(yaml) as YamlRecord;
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => (current as YamlRecord)[key], value);
}

function step(job: string, key: string, document = workflow()): YamlRecord {
  const steps = at(document, 'jobs', job, 'steps') as YamlRecord[];
  const found = steps.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`Missing step ${job}.${key}`);
  return found;
}

function evaluate(source: unknown, context: YamlRecord): unknown {
  const expression = expressionPattern.exec(String(source).trim())?.[1] ?? String(source);
  return environment.evaluate(expression, context);
}

function interpolate(source: unknown, context: YamlRecord): string {
  return String(source).replace(interpolationPattern, (_match, expression: string) =>
    String(environment.evaluate(expression, context)),
  );
}

function failedRun(overrides: YamlRecord = {}): YamlRecord {
  return {
    repository: {
      full_name: 'acme/api',
      name: 'api',
      owner: {login: 'acme'},
      default_branch: 'main',
    },
    workflow_run: {
      id: 30433642,
      workflow_id: 161335,
      run_number: 12,
      run_attempt: 1,
      name: 'CI',
      path: '.github/workflows/ci.yml',
      conclusion: 'failure',
      event: 'push',
      head_branch: 'main',
      head_sha: 'a'.repeat(40),
      head_repository: {full_name: 'acme/api'},
      ...overrides,
    },
  };
}

function run(
  number: number,
  conclusion: string,
  overrides: YamlRecord = {},
): Record<string, unknown> {
  return {
    run_number: number,
    conclusion,
    status: 'completed',
    event: 'push',
    head_branch: 'main',
    ...overrides,
  };
}

function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-default-branch-ci-'));
  roots.push(root);
  const remote = join(root, 'remote.git');
  const cwd = join(root, 'checkout');
  const git = (...args: string[]) =>
    execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], {stdio: 'ignore'});
  execFileSync('git', ['clone', remote, cwd], {stdio: 'ignore'});
  git('config', 'user.email', 'template-test@example.com');
  git('config', 'user.name', 'Template Test');
  git('config', 'commit.gpgsign', 'false');
  git('switch', '-c', 'main');
  writeFileSync(join(cwd, 'app.txt'), 'broken\n');
  git('add', 'app.txt');
  git('commit', '-m', 'Break the build');
  git('push', 'origin', 'HEAD:main');
  const head = git('rev-parse', 'HEAD');
  const output = join(root, 'outputs');
  const execute = (job: string, key: string, env: Record<string, string> = {}) => {
    writeFileSync(output, '');
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', String(step(job, key).run)],
      {
        cwd,
        encoding: 'utf8',
        env: {...process.env, SHIPFOX_OUTPUT: output, EXPECTED_HEAD: head, ...env},
      },
    );
    const values = Object.fromEntries(
      readFileSync(output, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const equal = line.indexOf('=');
          return [line.slice(0, equal), line.slice(equal + 1)];
        }),
    );
    return {...result, values};
  };
  return {cwd, git, head, remote, execute};
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('default-branch CI repair template', () => {
  it('adds the Slack report job and header binding only when the report role is bound', () => {
    expect(Object.keys(at(workflow(false), 'jobs') as YamlRecord)).toEqual([
      'inspect',
      'investigate',
      'deliver',
    ]);
    expect(render(false)).toContain('# shipfox-template: fix-default-branch-ci@1 source=github\n');
    expect(render(false)).not.toContain('send_message');

    expect(Object.keys(at(workflow(true), 'jobs') as YamlRecord)).toEqual([
      'inspect',
      'investigate',
      'deliver',
      'report',
    ]);
    expect(render(true)).toContain(
      '# shipfox-template: fix-default-branch-ci@1 source=github report=slack\n',
    );
  });

  it.each([
    {outcomes: 'needs_person', steps: ['report_diagnosis']},
    {outcomes: 'pull_requests', steps: ['report_pull_request']},
    {outcomes: 'both', steps: ['report_diagnosis', 'report_pull_request']},
  ] as const)('posts $outcomes to Slack', ({outcomes, steps}) => {
    const report = at(workflow(true, outcomes), 'jobs', 'report', 'steps') as YamlRecord[];

    expect(report.map(({key}) => key)).toEqual(steps);
  });

  it('investigates from a read-only checkout and gives the agent only read tools', () => {
    expect(step('investigate', 'checkout_default_branch').checkout).toMatchObject({
      ref: expect.stringContaining('event.repository.default_branch'),
      permissions: {contents: 'read'},
      'persist-credentials': false,
    });
    expect(step('investigate', 'investigate').integrations).toEqual([
      {
        connection: 'github_source',
        include: [
          'get_job_logs',
          'actions_list.list_workflow_runs',
          'actions_list.list_workflow_jobs',
        ],
      },
    ]);
    expect(step('deliver', 'checkout_repair_base').checkout).toMatchObject({
      ref: expect.stringContaining('jobs.investigate.outputs.commit'),
      permissions: {contents: 'write'},
    });
  });

  const triggerFilter = String(at(workflow(), 'triggers', 'on_default_branch_failure', 'filter'))
    .replace('replace-with-owner/repository', 'acme/api')
    .replace('replace-with-workflow-path', '.github/workflows/ci.yml');

  it.each([
    {name: 'a failed push run on the default branch', overrides: {}, expected: true},
    {name: 'a failed scheduled run', overrides: {event: 'schedule'}, expected: true},
    {name: 'a successful run', overrides: {conclusion: 'success'}, expected: false},
    {name: 'a pull request run', overrides: {event: 'pull_request'}, expected: false},
    {name: 'a rerun', overrides: {run_attempt: 2}, expected: false},
    {name: 'another branch', overrides: {head_branch: 'feature'}, expected: false},
    {
      name: 'an unlisted workflow',
      overrides: {path: '.github/workflows/deploy.yml'},
      expected: false,
    },
    {
      name: 'a fork branch named like the default branch',
      overrides: {head_repository: {full_name: 'fork/api'}},
      expected: false,
    },
  ])('starts for $name: $expected', ({overrides, expected}) => {
    expect(evaluate(triggerFilter, {event: failedRun(overrides)})).toBe(expected);
  });

  it('ignores failures from another repository on the same connection', () => {
    const event = failedRun();
    (event.repository as YamlRecord).full_name = 'acme/other';

    expect(evaluate(triggerFilter, {event})).toBe(false);
  });

  it('skips a failure while a repair pull request for the same workflow is open', () => {
    const event = failedRun();
    const branch = interpolate(at(step('deliver', 'push_repair'), 'env', 'BRANCH_NAME'), {event});
    const headRefs = at(step('inspect', 'open_repairs'), 'outputs', 'head_refs');
    const count = at(workflow(), 'jobs', 'inspect', 'outputs', 'open_repairs');
    const openRepairs = (refs: string[]) => {
      const result = {pull_requests: refs.map((ref) => ({head: {ref}}))};
      const steps = {open_repairs: {outputs: {head_refs: evaluate(headRefs, {result})}}};
      return Number(evaluate(count, {event, steps}));
    };

    expect(branch).toBe('shipfox/default-branch-ci/161335-30433642');
    expect(openRepairs([branch])).toBe(1);
    expect(openRepairs(['shipfox/default-branch-ci/99-1'])).toBe(0);
    expect(openRepairs(['feature'])).toBe(0);
  });

  it.each([
    {name: 'the previous run passed', runs: [run(11, 'success')], expected: 'success'},
    {name: 'the previous run failed', runs: [run(11, 'failure')], expected: 'failure'},
    {name: 'no earlier run is listed', runs: [], expected: 'unknown'},
    {
      name: 'only later, cancelled, pull request, or other-branch runs precede it',
      runs: [
        run(13, 'failure'),
        run(12, 'failure'),
        run(11, 'cancelled'),
        run(10, 'failure', {event: 'pull_request'}),
        run(9, 'failure', {head_branch: 'feature'}),
        run(8, 'failure', {status: 'in_progress'}),
        run(7, 'success'),
      ],
      expected: 'success',
    },
  ])('reads the previous default-branch conclusion when $name', ({runs, expected}) => {
    const projected = at(step('inspect', 'history'), 'outputs', 'runs');
    const previous = at(workflow(), 'jobs', 'inspect', 'outputs', 'previous_conclusion');
    const steps = {
      history: {outputs: {runs: evaluate(projected, {result: {workflow_runs: runs}})}},
    };

    expect(evaluate(previous, {event: failedRun(), steps})).toBe(expected);
  });

  it.each([
    {count: 0, previous: 'success', expected: true},
    {count: 0, previous: 'unknown', expected: true},
    {count: 0, previous: 'failure', expected: false},
    {count: 1, previous: 'success', expected: false},
  ])('investigates with $count open repairs after $previous: $expected', ({
    count,
    previous,
    expected,
  }) => {
    const condition = at(workflow(), 'jobs', 'investigate', 'if');
    const jobs = {inspect: {outputs: {open_repairs: count, previous_conclusion: previous}}};

    expect(evaluate(condition, {jobs, needs: [{status: 'succeeded'}]})).toBe(expected);
  });

  it('delivers a tested patch with new and binary files on a fresh checkout', () => {
    const investigation = checkout();
    writeFileSync(join(investigation.cwd, 'app.txt'), 'fixed\n');
    writeFileSync(join(investigation.cwd, 'fixture.bin'), Buffer.from([0, 1, 2, 255]));
    investigation.git('add', 'app.txt', 'fixture.bin');

    expect(investigation.execute('investigate', 'check_changes').status).toBe(0);
    const packaged = investigation.execute('investigate', 'package');
    expect(packaged.values.outcome).toBe('ready');

    investigation.git('reset', '--hard', investigation.head);
    const delivered = investigation.execute('deliver', 'push_repair', {
      PATCH_BASE64: packaged.values.patch_base64 ?? '',
      COMMIT_TITLE: 'Fix the build',
      BRANCH_NAME: 'shipfox/default-branch-ci/161335-30433642',
    });

    expect(delivered.status).toBe(0);
    expect(delivered.values.branch).toBe('shipfox/default-branch-ci/161335-30433642');
    const git = (...args: string[]) =>
      execFileSync('git', ['--git-dir', investigation.remote, ...args], {encoding: 'utf8'}).trim();
    expect(git('rev-parse', 'refs/heads/shipfox/default-branch-ci/161335-30433642')).toBe(
      delivered.values.commit,
    );
    expect(git('rev-parse', 'refs/heads/main')).toBe(investigation.head);
    expect(git('show', `${delivered.values.commit}:app.txt`)).toBe('fixed');
    expect(
      execFileSync('git', [
        '--git-dir',
        investigation.remote,
        'show',
        `${delivered.values.commit}:fixture.bin`,
      ]),
    ).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('refuses to deliver onto a commit other than the investigated one', () => {
    const repo = checkout();
    repo.git('commit', '--allow-empty', '-m', 'Newer commit');

    const result = repo.execute('deliver', 'push_repair', {
      PATCH_BASE64: '',
      COMMIT_TITLE: 'Fix the build',
      BRANCH_NAME: 'shipfox/default-branch-ci/1-1',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not the investigated commit');
  });

  it('reports an oversized repair instead of delivering a truncated patch', () => {
    const repo = checkout();
    writeFileSync(join(repo.cwd, 'app.txt'), 'x'.repeat(31000));
    repo.git('add', 'app.txt');

    const result = repo.execute('investigate', 'package');

    expect(result.status).toBe(0);
    expect(result.values).toEqual({outcome: 'patch_too_large', patch_base64: ''});
  });

  it.each([
    {
      name: 'unstaged changes',
      arrange: (cwd: string) => writeFileSync(join(cwd, 'app.txt'), 'test output\n'),
      error: 'Unstaged changes remain',
    },
    {
      name: 'untracked files',
      arrange: (cwd: string) => writeFileSync(join(cwd, 'report.xml'), '<testsuite/>\n'),
      error: 'Unstaged changes remain',
    },
    {name: 'an empty repair', arrange: () => undefined, error: 'no staged changes'},
  ])('rejects a repair candidate with $name', ({arrange, error}) => {
    const repo = checkout();
    arrange(repo.cwd);

    const result = repo.execute('investigate', 'check_changes');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(error);
  });

  it('rejects a repair that rewrote the investigated commit', () => {
    const repo = checkout();
    writeFileSync(join(repo.cwd, 'app.txt'), 'fixed\n');
    repo.git('commit', '-am', 'Agent commit');
    writeFileSync(join(repo.cwd, 'app.txt'), 'fixed again\n');
    repo.git('add', 'app.txt');

    const result = repo.execute('investigate', 'check_changes');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('changed the commit history');
  });

  it.each([
    {
      deliver: 'succeeded',
      status: 'repair_candidate',
      outcome: 'ready',
      posts: ['report_pull_request'],
    },
    {deliver: 'skipped', status: 'needs_human', outcome: 'none', posts: ['report_diagnosis']},
    {
      deliver: 'skipped',
      status: 'repair_candidate',
      outcome: 'patch_too_large',
      posts: ['report_diagnosis'],
    },
    {deliver: 'skipped', status: 'not_actionable', outcome: 'none', posts: []},
    {deliver: 'failed', status: 'repair_candidate', outcome: 'ready', posts: []},
  ])('posts $posts to Slack for $status with $outcome after delivery $deliver', ({
    deliver,
    status,
    outcome,
    posts,
  }) => {
    const document = workflow(true, 'both');
    const jobs = {
      investigate: {status: 'succeeded', outputs: {status, outcome}},
      deliver: {status: deliver},
    };

    expect(evaluate(at(document, 'jobs', 'report', 'if'), {jobs})).toBe(true);
    const report = at(document, 'jobs', 'report', 'steps') as YamlRecord[];
    expect(report.filter((entry) => evaluate(entry.if, {jobs})).map(({key}) => key)).toEqual(posts);
  });

  it('posts nothing when the failure was skipped before investigation', () => {
    const jobs = {investigate: {status: 'skipped'}, deliver: {status: 'skipped'}};

    expect(evaluate(at(workflow(true), 'jobs', 'report', 'if'), {jobs})).toBe(false);
  });
});
