import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {composeTemplate} from './composer.js';
import {loadShippedTemplates} from './loader.js';

const template = loadShippedTemplates().find((entry) => entry.manifest.id === 'fix-dependency-ci');
if (template === undefined) throw new Error('Missing dependency repair template');
const composed = composeTemplate(template, {source: 'github'});
const roots: string[] = [];
const deliveryMarker = /^\s*# option:delivery_mode=(\w+) (begin|end)$/;

function workflow(mode: 'push_fix' | 'comment_only') {
  let selected = true;
  const yaml = composed
    .split('\n')
    .filter((line) => {
      const marker = deliveryMarker.exec(line);
      if (marker !== null) {
        selected = marker[2] === 'end' || marker[1] === mode;
        return false;
      }
      return selected;
    })
    .join('\n');
  return parseWorkflowDocument(parseYaml(yaml));
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
          BOT_BRANCH: 'bot/update',
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

describe('dependency CI repair', () => {
  it.each(['push_fix', 'comment_only'] as const)('parses the %s delivery variant', (mode) => {
    expect(workflow(mode).concurrency?.cancel_in_progress).toBe(false);
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
