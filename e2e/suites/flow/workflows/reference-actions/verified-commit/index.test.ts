import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {runAction, type ToolFakes, toolError, toolResult} from '@shipfox/actions/testing';

const execFileAsync = promisify(execFile);
const action = new URL('./', import.meta.url);
const inputs = {repository: 'acme/app', pull_request: 7, message: 'Update notes\n\nFrom a job.'};

describe('verified-commit', () => {
  let checkout: string;
  let head: string;

  // The action compares a git checkout with the pull request head, so each test gets a repository.
  beforeEach(async () => {
    checkout = await mkdtemp(join(tmpdir(), 'verified-commit-test-'));
    await git('init', '--quiet', '--initial-branch=feature');
    await writeFile(join(checkout, 'notes.md'), 'first\n');
    await writeFile(join(checkout, 'old.md'), 'old\n');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'Initial');
    head = (await git('rev-parse', 'HEAD')).trim();
  });

  afterEach(async () => {
    await rm(checkout, {recursive: true, force: true});
  });

  it('publishes the local changes as one commit on the pull request head', async () => {
    await writeFile(join(checkout, 'notes.md'), 'second\n');
    await rm(join(checkout, 'old.md'));

    const result = await runAction(action, {
      inputs,
      workspace: checkout,
      tools: github({
        create_commit: () =>
          toolResult({commit: {oid: 'c0ffee', url: 'https://github.com/acme/app/commit/c0ffee'}}),
      }),
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: {outcome: 'committed', branch: 'feature', commit_sha: 'c0ffee'},
    });
    expect(result.calls.find((call) => call.tool === 'create_commit')?.args).toEqual({
      repository: 'acme/app',
      branch: 'feature',
      expected_head_oid: head,
      message: {headline: 'Update notes', body: 'From a job.'},
      additions: [{path: 'notes.md', contents: 'second\n', encoding: 'utf8'}],
      deletions: [{path: 'old.md'}],
    });
  });

  it('reports no_changes when the checkout matches the head', async () => {
    const result = await runAction(action, {inputs, workspace: checkout, tools: github()});

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: {outcome: 'no_changes', branch: 'feature'},
    });
    expect(result.calls.map((call) => call.tool)).toEqual(['pull_request_read.get']);
  });

  it('refuses an oversized change before calling create_commit', async () => {
    await writeFile(join(checkout, 'large.txt'), 'a'.repeat(1_000_001));

    const result = await runAction(action, {inputs, workspace: checkout, tools: github()});

    expect(result.status).toBe('failed');
    expect(result.logs).toContain('above the 1000000 bytes one verified commit can carry');
    expect(result.calls.map((call) => call.tool)).toEqual(['pull_request_read.get']);
  });

  it('asks to recompute the change when the branch moved', async () => {
    await writeFile(join(checkout, 'notes.md'), 'second\n');

    const result = await runAction(action, {
      inputs,
      workspace: checkout,
      tools: github({
        create_commit: () => {
          throw toolError({
            code: 'provider-rejected',
            reason: 'stale-head',
            message: `Stale branch head (stale-head): expected_head_oid ${head} did not match the branch tip.`,
          });
        },
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.logs).toContain(
      `Branch feature no longer points to ${head}, so nothing was published. Check out the new ` +
        'head, recompute the change, and run again.',
    );
  });

  it('does not retry a commit whose outcome is unknown', async () => {
    await writeFile(join(checkout, 'notes.md'), 'second\n');

    const result = await runAction(action, {
      inputs,
      workspace: checkout,
      tools: github({
        create_commit: () => {
          throw toolError({code: 'provider-unavailable', outcomeUnknown: true});
        },
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.logs).toContain('so it may have landed on feature');
    expect(result.calls.filter((call) => call.tool === 'create_commit')).toHaveLength(1);
  });

  function github(fakes: ToolFakes[string] = {}): ToolFakes {
    return {
      github: {
        'pull_request_read.get': () => toolResult({head: {ref: 'feature', sha: head}}),
        ...fakes,
      },
    };
  }

  async function git(...args: string[]): Promise<string> {
    const {stdout} = await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {cwd: checkout},
    );
    return stdout;
  }
});
