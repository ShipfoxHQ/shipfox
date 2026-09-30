import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  type GithubApiMock,
  startGithubApiMock,
} from './github-api.js';

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH_LINE = /^ref: refs\/heads\/main\tHEAD$/mu;
const GIT_IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const {stdout} = await execFileAsync('git', [...GIT_IDENTITY, ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return stdout.trim();
}

// git sends the token the way the runner's credential helper supplies it.
function authorizedGit(cwd: string, token: string, ...args: string[]): Promise<string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return git(cwd, '-c', `http.extraheader=Authorization: Basic ${basic}`, ...args);
}

describe('GitHub fake git transport', () => {
  let mock: GithubApiMock;
  let directory: string;
  let seedDirectory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'github-fake-test-'));
    seedDirectory = join(directory, 'seed');
    await mkdir(join(seedDirectory, 'src'), {recursive: true});
    await writeFile(join(seedDirectory, 'src', 'index.ts'), 'export const value = 1;\n');
    await writeFile(join(seedDirectory, 'seed-only.txt'), 'only on the default branch\n');
    mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationToken: GITHUB_STATEFUL_INSTALLATION_TOKEN,
    });
  });

  afterEach(async () => {
    await mock.stop();
    await rm(directory, {recursive: true, force: true});
  });

  it('describes a repository with a clone URL that keeps the GitHub identity', async () => {
    const repository = await mock.addRepository({
      owner: 'acme',
      name: 'report-cli',
      seedDirectory,
      defaultBranch: 'trunk',
    });

    const response = await fetch(new URL('/repos/acme/report-cli', mock.endpoint), {
      headers: {authorization: `token ${GITHUB_STATEFUL_INSTALLATION_TOKEN}`},
    });
    const byId = await fetch(new URL(`/repositories/${repository.id}`, mock.endpoint));

    await expect(response.json()).resolves.toMatchObject({
      id: repository.id,
      full_name: 'acme/report-cli',
      default_branch: 'trunk',
      clone_url: new URL('/github.com/acme/report-cli.git', mock.endpoint).toString(),
    });
    await expect(byId.json()).resolves.toMatchObject({full_name: 'acme/report-cli'});
  });

  it('serves the seeded files, the default branch, and the branches to a clone', async () => {
    await mock.addRepository({owner: 'acme', name: 'report-cli', seedDirectory});
    const cloneUrl = new URL('/github.com/acme/report-cli.git', mock.endpoint).toString();
    const checkout = join(directory, 'checkout');

    await authorizedGit(directory, GITHUB_STATEFUL_INSTALLATION_TOKEN, 'clone', cloneUrl, checkout);

    await expect(readFile(join(checkout, 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'export const value = 1;\n',
    );
    await expect(git(checkout, 'remote', 'get-url', 'origin')).resolves.toBe(cloneUrl);
    const defaultBranch = await authorizedGit(
      checkout,
      GITHUB_STATEFUL_INSTALLATION_TOKEN,
      'ls-remote',
      '--symref',
      'origin',
      'HEAD',
    );
    expect(defaultBranch).toMatch(DEFAULT_BRANCH_LINE);
  });

  it('adds a branch whose tree is the directory, on top of the default branch', async () => {
    await mock.addRepository({owner: 'acme', name: 'report-cli', seedDirectory});
    const branchDirectory = join(directory, 'branch');
    await mkdir(join(branchDirectory, 'src'), {recursive: true});
    await writeFile(join(branchDirectory, 'src', 'index.ts'), 'export const value = 2;\n');
    await writeFile(join(branchDirectory, 'update.txt'), 'bumped\n');

    const tip = await mock.addBranch({
      owner: 'acme',
      name: 'report-cli',
      branch: 'dependabot/npm_and_yarn/left-pad-1.1.0',
      directory: branchDirectory,
    });

    const cloneUrl = new URL('/github.com/acme/report-cli.git', mock.endpoint).toString();
    const checkout = join(directory, 'checkout');
    await authorizedGit(directory, GITHUB_STATEFUL_INSTALLATION_TOKEN, 'clone', cloneUrl, checkout);
    const main = await git(checkout, 'rev-parse', 'HEAD');
    await git(checkout, 'switch', 'dependabot/npm_and_yarn/left-pad-1.1.0');
    expect(await git(checkout, 'rev-parse', 'HEAD')).toBe(tip);
    expect(await git(checkout, 'rev-parse', 'HEAD~1')).toBe(main);
    await expect(readFile(join(checkout, 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'export const value = 2;\n',
    );
    await expect(readFile(join(checkout, 'update.txt'), 'utf8')).resolves.toBe('bumped\n');
    expect(mock.branchHeads.get('dependabot/npm_and_yarn/left-pad-1.1.0')).toBe(tip);
    expect(mock.writes()).toEqual([]);
    // The branch holds the directory's files alone, not the default branch's files plus a change.
    expect((await git(checkout, 'ls-tree', '-r', '--name-only', tip)).split('\n')).toEqual([
      'src/index.ts',
      'update.txt',
    ]);
  });

  it('refuses a branch that already exists, the default branch included', async () => {
    await mock.addRepository({owner: 'acme', name: 'report-cli', seedDirectory});
    const params = {owner: 'acme', name: 'report-cli', directory: seedDirectory};
    await mock.addBranch({...params, branch: 'update'});

    await expect(mock.addBranch({...params, branch: 'update'})).rejects.toThrow();
    await expect(mock.addBranch({...params, branch: 'main'})).rejects.toThrow();
  });

  it('refuses a branch on a repository the fake does not have', async () => {
    await expect(
      mock.addBranch({owner: 'acme', name: 'missing', branch: 'update', directory: seedDirectory}),
    ).rejects.toThrow('acme/missing is not registered');
  });

  it('refuses a request that does not carry the minted token', async () => {
    await mock.addRepository({owner: 'acme', name: 'report-cli', seedDirectory});
    const cloneUrl = new URL('/github.com/acme/report-cli.git', mock.endpoint).toString();

    await expect(
      authorizedGit(directory, 'ghs_wrong', 'clone', cloneUrl, join(directory, 'wrong')),
    ).rejects.toThrow();
    await expect(git(directory, 'clone', cloneUrl, join(directory, 'anonymous'))).rejects.toThrow();
  });

  it('resolves a bot user, so a write checkout can author commits as the app', async () => {
    const response = await fetch(new URL('/users/shipfox-e2e%5Bbot%5D', mock.endpoint));

    await expect(response.json()).resolves.toMatchObject({login: 'shipfox-e2e[bot]', type: 'Bot'});
  });

  it('answers 404 for a repository the fake does not have', async () => {
    const response = await fetch(new URL('/github.com/acme/missing.git/info/refs', mock.endpoint));

    expect(response.status).toBe(404);
  });

  it('records each pushed branch with its before and after commits', async () => {
    await mock.addRepository({owner: 'acme', name: 'report-cli', seedDirectory});
    const cloneUrl = new URL('/github.com/acme/report-cli.git', mock.endpoint).toString();
    const checkout = join(directory, 'checkout');
    await authorizedGit(directory, GITHUB_STATEFUL_INSTALLATION_TOKEN, 'clone', cloneUrl, checkout);
    const base = await git(checkout, 'rev-parse', 'HEAD');

    await git(checkout, 'switch', '-c', 'shipfox/task-1-1-1');
    await writeFile(join(checkout, 'src', 'index.ts'), 'export const value = 2;\n');
    await git(checkout, 'commit', '--all', '--message', 'Change the value');
    const change = await git(checkout, 'rev-parse', 'HEAD');
    await authorizedGit(
      checkout,
      GITHUB_STATEFUL_INSTALLATION_TOKEN,
      'push',
      'origin',
      'shipfox/task-1-1-1',
    );
    await writeFile(join(checkout, 'src', 'index.ts'), 'export const value = 3;\n');
    await git(checkout, 'commit', '--all', '--message', 'Fix the value');
    const fix = await git(checkout, 'rev-parse', 'HEAD');
    await authorizedGit(
      checkout,
      GITHUB_STATEFUL_INSTALLATION_TOKEN,
      'push',
      'origin',
      'shipfox/task-1-1-1',
    );
    await authorizedGit(
      checkout,
      GITHUB_STATEFUL_INSTALLATION_TOKEN,
      'push',
      'origin',
      '--delete',
      'shipfox/task-1-1-1',
    );

    expect(mock.writes()).toEqual([
      {
        kind: 'github.push',
        target: 'acme/report-cli:shipfox/task-1-1-1',
        payload: {
          repository: 'acme/report-cli',
          branch: 'shipfox/task-1-1-1',
          before: null,
          after: change,
        },
      },
      {
        kind: 'github.push',
        target: 'acme/report-cli:shipfox/task-1-1-1',
        payload: {
          repository: 'acme/report-cli',
          branch: 'shipfox/task-1-1-1',
          before: change,
          after: fix,
        },
      },
      {
        kind: 'github.push',
        target: 'acme/report-cli:shipfox/task-1-1-1',
        payload: {
          repository: 'acme/report-cli',
          branch: 'shipfox/task-1-1-1',
          before: fix,
          after: null,
        },
      },
    ]);
    await expect(git(checkout, 'rev-parse', `${change}~1`)).resolves.toBe(base);
  });

  it('records nothing for a push the fake refused', async () => {
    await mock.addRepository({owner: 'acme', name: 'report-cli', seedDirectory});
    const cloneUrl = new URL('/github.com/acme/report-cli.git', mock.endpoint).toString();
    const checkout = join(directory, 'checkout');
    await authorizedGit(directory, GITHUB_STATEFUL_INSTALLATION_TOKEN, 'clone', cloneUrl, checkout);
    await writeFile(join(checkout, 'src', 'index.ts'), 'export const value = 2;\n');
    await git(checkout, 'commit', '--all', '--message', 'Change the value');

    await expect(
      authorizedGit(checkout, 'ghs_wrong', 'push', 'origin', 'HEAD:refs/heads/other'),
    ).rejects.toThrow();

    expect(mock.writes()).toEqual([]);
  });
});
