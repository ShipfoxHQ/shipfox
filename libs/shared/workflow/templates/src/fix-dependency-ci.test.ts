import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkflowEnvironment} from '@shipfox/expression';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {composeTemplate} from './composer.js';
import {loadShippedTemplates} from './loader.js';

type DeliveryMode = 'push_fix' | 'comment_only';
type Selection = 'dependency_bot' | 'label' | 'all_pull_requests';
type YamlRecord = Record<string, unknown>;

const template = loadShippedTemplates().find((entry) => entry.id === 'fix-dependency-ci');
if (template === undefined) throw new Error('Missing dependency repair template');
const composed = composeTemplate(template, {source: 'github'});
const roots: string[] = [];
const optionMarker = /^\s*# option:(\w+)=(\w+) (begin|end)$/;
const expressionPattern = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/;
const environment = createWorkflowEnvironment();
const selections: Selection[] = ['dependency_bot', 'label', 'all_pull_requests'];
const modes: DeliveryMode[] = ['push_fix', 'comment_only'];

function render(mode: DeliveryMode, selection: Selection = 'dependency_bot'): YamlRecord {
  const chosen: Record<string, string> = {delivery_mode: mode, pr_selection: selection};
  const blocks: boolean[] = [];
  const yaml = composed
    .split('\n')
    .filter((line) => {
      const marker = optionMarker.exec(line);
      if (marker === null) return blocks.every(Boolean);
      const [, option = '', choice = '', boundary] = marker;
      if (boundary === 'begin') blocks.push(chosen[option] === choice);
      else blocks.pop();
      return false;
    })
    .join('\n');
  return parseYaml(yaml) as YamlRecord;
}

function workflow(mode: DeliveryMode, selection: Selection = 'dependency_bot') {
  return parseWorkflowDocument(render(mode, selection));
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => (current as YamlRecord)[key], value);
}

function evaluate(source: unknown, context: YamlRecord): unknown {
  const expression = expressionPattern.exec(String(source).trim())?.[1] ?? String(source);
  return environment.evaluate(expression, context);
}

function triggerFilter(selection: Selection): unknown {
  return at(render('push_fix', selection), 'triggers', 'on_pull_request_ci_failure', 'filter');
}

function readPrOutput(selection: Selection, output: string): unknown {
  const steps = at(render('push_fix', selection), 'jobs', 'inspect', 'steps') as YamlRecord[];
  return at(
    steps.find((step) => step.key === 'read_pr'),
    'outputs',
    output,
  );
}

function failedRun(overrides: YamlRecord = {}): YamlRecord {
  return {
    repository: {full_name: 'replace-with-owner/repository'},
    workflow_run: {
      conclusion: 'failure',
      pull_requests: [{number: 42}],
      run_attempt: 1,
      actor: {login: 'dependabot[bot]'},
      head_branch: 'bot/update',
      head_sha: 'a'.repeat(40),
      head_commit: {message: 'Bump left-pad from 1.0.0 to 1.1.0'},
      ...overrides,
    },
  };
}

function script(key: string, mode: 'push_fix' | 'comment_only' = 'comment_only') {
  const step = workflow(mode).jobs.fix?.steps?.find((entry) => entry.key === key);
  if (step === undefined || !('run' in step) || typeof step.run !== 'string') {
    throw new Error(`Missing run step ${key}`);
  }
  return step.run;
}

function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-dependency-repair-'));
  roots.push(root);
  const remote = join(root, 'remote.git');
  const cwd = join(root, 'checkout');
  const git = (...args: string[]) =>
    execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  execFileSync('git', ['init', '--bare', remote], {stdio: 'ignore'});
  execFileSync('git', ['clone', remote, cwd], {stdio: 'ignore'});
  git('config', 'user.email', 'template-test@example.com');
  git('config', 'user.name', 'Template Test');
  git('config', 'commit.gpgsign', 'false');
  git('switch', '-c', 'bot/update');
  writeFileSync(join(cwd, 'dependency.txt'), 'version 2\n');
  git('add', 'dependency.txt');
  git('commit', '-m', 'Update dependency');
  git('push', 'origin', 'HEAD:bot/update');
  const head = git('rev-parse', 'HEAD');
  const output = join(root, 'outputs');
  const run = (
    key: string,
    mode: 'push_fix' | 'comment_only' = 'comment_only',
    env: Record<string, string> = {},
  ) => {
    writeFileSync(output, '');
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(key, mode)],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          SHIPFOX_OUTPUT: output,
          EXPECTED_HEAD: head,
          PR_CURRENT: 'true',
          PR_BRANCH: 'bot/update',
          FAILED_RUN_URL: 'https://github.com/acme/api/actions/runs/7',
          REPAIR_STATUS: 'repair_candidate',
          COMMIT_TITLE: 'fix: adapt to dependency update',
          ...env,
        },
      },
    );
    const values = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const equal = line.indexOf('=');
          return [line.slice(0, equal), line.slice(equal + 1)];
        }),
    );
    return {...result, values};
  };
  return {cwd, git, head, run};
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('pull request CI repair', () => {
  it.each(
    selections.flatMap((selection) => modes.map((mode) => ({selection, mode}))),
  )('parses the $selection selection with $mode delivery', ({selection, mode}) => {
    expect(workflow(mode, selection).concurrency?.cancel_in_progress).toBe(false);
  });

  it.each([
    {selection: 'dependency_bot', actor: 'dependabot[bot]', expected: true},
    {selection: 'dependency_bot', actor: 'octocat', expected: false},
    {selection: 'label', actor: 'octocat', expected: true},
    {selection: 'all_pull_requests', actor: 'octocat', expected: true},
  ] as const)('starts for $selection when $actor ran CI: $expected', ({
    selection,
    actor,
    expected,
  }) => {
    const event = failedRun({actor: {login: actor}});

    expect(evaluate(triggerFilter(selection), {event})).toBe(expected);
  });

  it.each(
    selections,
  )('ignores reruns and failures on its own repair commits for %s', (selection) => {
    const repairCommit = failedRun({
      actor: {login: 'shipfox[bot]'},
      head_commit: {
        message: 'Fix build\n\nShipfox-CI-Repair: https://github.com/acme/api/actions/runs/7',
      },
    });

    expect(evaluate(triggerFilter(selection), {event: failedRun({run_attempt: 2})})).toBe(false);
    expect(evaluate(triggerFilter(selection), {event: repairCommit})).toBe(false);
  });

  it.each(selections)('starts for %s when the event has no head commit', (selection) => {
    const event = failedRun({head_commit: null});

    expect(evaluate(triggerFilter(selection), {event})).toBe(true);
  });

  it.each([
    {selection: 'dependency_bot', author: 'dependabot[bot]', labels: [], expected: true},
    {selection: 'dependency_bot', author: 'octocat', labels: [], expected: false},
    {selection: 'label', author: 'octocat', labels: ['replace-with-label-name'], expected: true},
    {selection: 'label', author: 'octocat', labels: ['bug'], expected: false},
    {selection: 'all_pull_requests', author: 'octocat', labels: [], expected: true},
  ] as const)('selects a PR by $author with labels $labels for $selection: $expected', ({
    selection,
    author,
    labels,
    expected,
  }) => {
    const event = failedRun({actor: {login: 'dependabot[bot]'}});
    const result = {
      state: 'open',
      user: {login: author},
      labels: labels.map((name) => ({name})),
      head: {
        repo: {full_name: 'replace-with-owner/repository'},
        ref: 'bot/update',
        sha: 'a'.repeat(40),
      },
    };
    const outputs = Object.fromEntries(
      ['open', 'author', 'selected', 'repository', 'branch', 'head_sha'].map((name) => [
        name,
        evaluate(readPrOutput(selection, name), {event, result}),
      ]),
    );
    const eligible = at(render('push_fix', selection), 'jobs', 'inspect', 'outputs', 'eligible');

    expect(evaluate(eligible, {event, steps: {read_pr: {outputs}}})).toBe(expected);
  });

  it.each([
    {name: 'the failed commit is the PR head', head: 'a'.repeat(40), expected: true},
    {name: 'a newer commit is the PR head', head: 'b'.repeat(40), expected: false},
  ])('repairs only when $name', ({head, expected}) => {
    const eligible = at(render('push_fix'), 'jobs', 'inspect', 'outputs', 'eligible');
    const outputs = {
      open: true,
      author: 'dependabot[bot]',
      selected: true,
      repository: 'replace-with-owner/repository',
      branch: 'bot/update',
      head_sha: head,
    };

    expect(evaluate(eligible, {event: failedRun(), steps: {read_pr: {outputs}}})).toBe(expected);
  });

  it('delivers a patch that applies new and binary files without changing the remote', () => {
    const repo = checkout();
    writeFileSync(join(repo.cwd, 'new-file.txt'), 'adapter\n');
    writeFileSync(join(repo.cwd, 'binary.dat'), Buffer.from([0, 1, 2, 255]));
    repo.git('add', 'new-file.txt', 'binary.dat');

    expect(repo.run('check_changes').status).toBe(0);
    const result = repo.run('deliver');

    expect(result.status).toBe(0);
    expect(result.values.outcome).toBe('proposed');
    expect(repo.git('ls-remote', 'origin', 'refs/heads/bot/update').split('\t')[0]).toBe(repo.head);
    repo.git('reset', '--hard', repo.head);
    const patch = Buffer.from(result.values.patch_base64 ?? '', 'base64');
    execFileSync('git', ['apply', '--index'], {cwd: repo.cwd, input: patch});
    expect(readFileSync(join(repo.cwd, 'new-file.txt'), 'utf8')).toBe('adapter\n');
    expect(readFileSync(join(repo.cwd, 'binary.dat'))).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('pushes the staged repair and reports its exact commit', () => {
    const repo = checkout();
    writeFileSync(join(repo.cwd, 'adapter.txt'), 'adapter\n');
    repo.git('add', 'adapter.txt');

    const result = repo.run('deliver', 'push_fix');

    expect(result.status).toBe(0);
    expect(result.values.outcome).toBe('pushed');
    expect(result.values.commit).not.toBe(repo.head);
    expect(repo.git('ls-remote', 'origin', 'refs/heads/bot/update').split('\t')[0]).toBe(
      result.values.commit,
    );
  });

  it.each(
    selections,
  )('does not repair CI that still fails on its pushed repair for %s', (selection) => {
    const repo = checkout();
    writeFileSync(join(repo.cwd, 'adapter.txt'), 'adapter\n');
    repo.git('add', 'adapter.txt');
    const result = repo.run('deliver', 'push_fix');
    const message = repo.git('log', '-1', '--format=%B', result.values.commit ?? '');
    const event = failedRun({
      actor: {login: 'dependabot[bot]'},
      head_sha: result.values.commit,
      head_commit: {message},
    });

    expect(message).toContain('Shipfox-CI-Repair: https://github.com/acme/api/actions/runs/7');
    expect(evaluate(triggerFilter(selection), {event})).toBe(false);
  });

  it('skips a repair after the remote branch moves', () => {
    const repo = checkout();
    repo.git('commit', '--allow-empty', '-m', 'New bot update');
    repo.git('push', 'origin', 'HEAD:bot/update');
    repo.git('reset', '--hard', repo.head);

    const result = repo.run('deliver', 'push_fix');

    expect(result.status).toBe(0);
    expect(result.values.outcome).toBe('superseded');
  });

  it.each(['no_change_needed', 'needs_human'])('reports %s without a commit', (status) => {
    const repo = checkout();

    const result = repo.run('deliver', 'push_fix', {REPAIR_STATUS: status});

    expect(result.status).toBe(0);
    expect(result.values.outcome).toBe(status);
    expect(repo.git('rev-parse', 'HEAD')).toBe(repo.head);
  });

  it('rejects unstaged installation output instead of including it in a repair', () => {
    const repo = checkout();
    writeFileSync(join(repo.cwd, 'dependency.txt'), 'unexpected install mutation\n');

    const result = repo.run('check_changes');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unstaged changes remain');
  });

  it('rejects an empty repair candidate', () => {
    const repo = checkout();

    const result = repo.run('check_changes');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no staged changes');
  });

  it('rejects staged GitHub workflow changes', () => {
    const repo = checkout();
    mkdirSync(join(repo.cwd, '.github', 'workflows'), {recursive: true});
    writeFileSync(join(repo.cwd, '.github', 'workflows', 'ci.yml'), 'name: changed\n');
    repo.git('add', '.github/workflows/ci.yml');

    const result = repo.run('check_changes');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Changes to GitHub workflows');
  });

  it('skips delivery when the live PR is no longer eligible', () => {
    const repo = checkout();

    const result = repo.run('deliver', 'push_fix', {PR_CURRENT: 'false'});

    expect(result.status).toBe(0);
    expect(result.values.outcome).toBe('superseded');
    expect(repo.git('rev-parse', 'HEAD')).toBe(repo.head);
  });

  it('reports an oversized patch without publishing a truncated patch', () => {
    const repo = checkout();
    writeFileSync(join(repo.cwd, 'adapter.txt'), 'x'.repeat(31000));
    repo.git('add', 'adapter.txt');

    const result = repo.run('deliver');

    expect(result.status).toBe(0);
    expect(result.values.outcome).toBe('patch_too_large');
    expect(result.values.patch_base64).toBe('');
  });

  it('records installation failure for diagnosis and fails validation on the same error', () => {
    const repo = checkout();
    const output = join(repo.cwd, '.git', 'outputs');
    const execute = (key: string) =>
      spawnSync(
        'bash',
        [
          '-eo',
          'pipefail',
          '-c',
          script(key)
            .replace('replace-with-install-command', 'echo install-failed; false')
            .replace('replace-with-test-command', 'echo should-not-run'),
        ],
        {cwd: repo.cwd, encoding: 'utf8', env: {...process.env, SHIPFOX_OUTPUT: output}},
      );

    const reproduction = execute('reproduce');
    const validation = execute('test');

    expect(reproduction.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('exit_code=1\n');
    expect(validation.status).toBe(1);
    expect(readFileSync(join(repo.cwd, '.git', 'shipfox-test.log'), 'utf8')).toBe(
      'install-failed\n',
    );
  });
});
