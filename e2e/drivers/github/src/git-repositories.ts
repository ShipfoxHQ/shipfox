import {execFile, spawn} from 'node:child_process';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {RecordedWrite} from '@shipfox/e2e-core';

const execFileAsync = promisify(execFile);

const FIRST_REPOSITORY_ID = 1000;
const NAME_SEGMENT = /^[A-Za-z0-9_.-]+$/u;
const GIT_PATH = /^\/github\.com\/([^/]+)\/([^/]+)\.git(\/.*)?$/u;
const CGI_HEADER_END = Buffer.from('\r\n\r\n');
const SEED_IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com'];

export interface GithubRepositoryFixture {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  /** The bare repository on disk. */
  path: string;
}

export interface AddGithubRepositoryParams {
  owner: string;
  name: string;
  /** Committed as the first commit on the default branch. Omitted, the repository is empty. */
  seedDirectory?: string | undefined;
  defaultBranch?: string | undefined;
}

export interface GitRepositories {
  add(params: AddGithubRepositoryParams): Promise<GithubRepositoryFixture>;
  findByName(params: {owner: string; name: string}): GithubRepositoryFixture | undefined;
  findById(id: number): GithubRepositoryFixture | undefined;
  /** Serves a request under `/github.com/<owner>/<repo>.git`. */
  handle(params: {
    request: IncomingMessage;
    response: ServerResponse;
    requestUrl: URL;
    installationToken: string;
    onWrite: (write: RecordedWrite) => void;
  }): Promise<void>;
  close(): Promise<void>;
}

/**
 * One bare repository per fixture repository, served over git smart HTTP by `git http-backend`.
 * The fake serves them at `/github.com/<owner>/<repo>.git`, so a remote URL keeps the GitHub
 * identity that templates parse.
 */
export function createGitRepositories(): GitRepositories {
  const repositories = new Map<string, GithubRepositoryFixture>();
  const pushQueues = new Map<string, Promise<void>>();
  let root: Promise<string> | undefined;
  let nextId = FIRST_REPOSITORY_ID;

  const rootDirectory = () => {
    root ??= mkdtemp(join(tmpdir(), 'github-fake-'));
    return root;
  };

  return {
    add: async (params) => {
      assertNameSegment(params.owner);
      assertNameSegment(params.name);
      const key = repositoryKey(params);
      if (repositories.has(key))
        throw new Error(`Repository ${params.owner}/${params.name} exists`);
      const defaultBranch = params.defaultBranch ?? 'main';
      const path = join(await rootDirectory(), params.owner, `${params.name}.git`);
      await mkdir(path, {recursive: true});
      await git(['init', '--bare', '--quiet', `--initial-branch=${defaultBranch}`, path]);
      if (params.seedDirectory !== undefined) await seed(path, params.seedDirectory);
      const repository: GithubRepositoryFixture = {
        id: nextId++,
        owner: params.owner,
        name: params.name,
        fullName: `${params.owner}/${params.name}`,
        defaultBranch,
        path,
      };
      repositories.set(key, repository);
      return repository;
    },
    findByName: (params) => repositories.get(repositoryKey(params)),
    findById: (id) => [...repositories.values()].find((repository) => repository.id === id),
    handle: async (params) => {
      const match = params.requestUrl.pathname.match(GIT_PATH);
      const repository =
        match === null
          ? undefined
          : repositories.get(
              repositoryKey({
                owner: decodeURIComponent(match[1] ?? ''),
                name: decodeURIComponent(match[2] ?? ''),
              }),
            );
      if (match === null || repository === undefined) {
        params.response.writeHead(404, {'content-type': 'text/plain'}).end('Not Found');
        return;
      }
      if (!hasInstallationToken(params.request, params.installationToken)) {
        params.response
          .writeHead(401, {
            'www-authenticate': 'Basic realm="GitHub"',
            'content-type': 'text/plain',
          })
          .end('Authentication required');
        return;
      }
      const serve = async () =>
        runBackend({
          repository,
          root: await rootDirectory(),
          pathInfo: `/${repository.owner}/${repository.name}.git${match[3] ?? ''}`,
          request: params.request,
          response: params.response,
          requestUrl: params.requestUrl,
        });
      if (!isReceivePack(params.request, match[3])) {
        await serve();
        params.response.end();
        return;
      }
      // Ref updates are found by comparing branches around the push, so pushes to one
      // repository take turns.
      const previous = pushQueues.get(repository.fullName) ?? Promise.resolve();
      const turn = previous.then(async () => {
        const before = await readBranches(repository);
        await serve();
        const after = await readBranches(repository);
        for (const write of diffBranches({repository, before, after})) params.onWrite(write);
        // The client sees the push finish only once its write is recorded.
        params.response.end();
      });
      pushQueues.set(
        repository.fullName,
        turn.catch(() => undefined),
      );
      await turn;
    },
    close: async () => {
      if (root === undefined) return;
      await rm(await root, {recursive: true, force: true});
    },
  };
}

function repositoryKey(params: {owner: string; name: string}): string {
  return `${params.owner}/${params.name}`.toLowerCase();
}

function assertNameSegment(value: string): void {
  if (!NAME_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid repository name segment: ${value}`);
  }
}

async function git(args: string[], options: {cwd?: string; env?: NodeJS.ProcessEnv} = {}) {
  return await execFileAsync('git', args, {
    ...(options.cwd === undefined ? {} : {cwd: options.cwd}),
    env: {...process.env, ...isolatedGitEnv(), ...options.env},
  });
}

function isolatedGitEnv(): NodeJS.ProcessEnv {
  return {GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0'};
}

async function seed(bareRepositoryPath: string, seedDirectory: string): Promise<void> {
  const tree = ['--git-dir', bareRepositoryPath, '--work-tree', seedDirectory];
  await git([...tree, 'add', '--all', '--force', '.'], {cwd: seedDirectory});
  await git([...tree, ...SEED_IDENTITY, 'commit', '--quiet', '--allow-empty', '-m', 'Seed'], {
    cwd: seedDirectory,
  });
}

function hasInstallationToken(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const decoded = Buffer.from(header.slice('basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return separator >= 0 && decoded.slice(separator + 1) === token;
}

function isReceivePack(request: IncomingMessage, rest: string | undefined): boolean {
  return request.method === 'POST' && rest === '/git-receive-pack';
}

async function readBranches(repository: GithubRepositoryFixture): Promise<Map<string, string>> {
  const {stdout} = await git([
    '--git-dir',
    repository.path,
    'for-each-ref',
    '--format=%(objectname) %(refname)',
    'refs/heads',
  ]);
  const branches = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const [oid, ref] = line.split(' ', 2);
    if (oid !== undefined && ref !== undefined) branches.set(ref.slice('refs/heads/'.length), oid);
  }
  return branches;
}

function diffBranches(params: {
  repository: GithubRepositoryFixture;
  before: Map<string, string>;
  after: Map<string, string>;
}): RecordedWrite[] {
  const names = new Set([...params.before.keys(), ...params.after.keys()]);
  const writes: RecordedWrite[] = [];
  for (const branch of [...names].sort()) {
    const before = params.before.get(branch) ?? null;
    const after = params.after.get(branch) ?? null;
    if (before === after) continue;
    writes.push({
      kind: 'push',
      target: `${params.repository.fullName}:${branch}`,
      payload: {repository: params.repository.fullName, branch, before, after},
    });
  }
  return writes;
}

// Runs `git http-backend` as a CGI process and relays its response, leaving the response open.
async function runBackend(params: {
  repository: GithubRepositoryFixture;
  root: string;
  pathInfo: string;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
}): Promise<void> {
  const {request, response} = params;
  const contentLength = request.headers['content-length'];
  const child = spawn('git', ['http-backend'], {
    env: {
      PATH: process.env.PATH ?? '',
      ...isolatedGitEnv(),
      GIT_PROJECT_ROOT: params.root,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: request.method ?? 'GET',
      PATH_INFO: params.pathInfo,
      QUERY_STRING: params.requestUrl.search.slice(1),
      // http-backend accepts pushes only from an authenticated user.
      REMOTE_USER: 'x-access-token',
      REMOTE_ADDR: request.socket.remoteAddress ?? '127.0.0.1',
      ...(request.headers['content-type'] === undefined
        ? {}
        : {CONTENT_TYPE: request.headers['content-type']}),
      ...(contentLength === undefined ? {} : {CONTENT_LENGTH: contentLength}),
      ...(request.headers['content-encoding'] === undefined
        ? {}
        : {HTTP_CONTENT_ENCODING: request.headers['content-encoding']}),
      ...(request.headers['git-protocol'] === undefined
        ? {}
        : {GIT_PROTOCOL: String(request.headers['git-protocol'])}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const finished = new Promise<void>((resolve) => {
    let head = Buffer.alloc(0);
    let headersSent = false;
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (headersSent) {
        response.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf(CGI_HEADER_END);
      if (end < 0) return;
      headersSent = true;
      const {status, headers} = parseCgiHeaders(head.subarray(0, end).toString('utf8'));
      response.writeHead(status, headers);
      response.write(head.subarray(end + CGI_HEADER_END.length));
    });
    child.on('close', () => {
      if (!headersSent) {
        response.writeHead(500, {'content-type': 'text/plain'});
        response.write(`git http-backend failed: ${stderr}`);
      }
      resolve();
    });
    child.on('error', (error) => {
      if (!response.headersSent) response.writeHead(500, {'content-type': 'text/plain'});
      response.write(`git http-backend failed to start: ${error.message}`);
      resolve();
    });
  });

  child.stdin.on('error', () => undefined);
  request.pipe(child.stdin);
  await finished;
}

function parseCgiHeaders(text: string): {status: number; headers: Record<string, string>} {
  let status = 200;
  const headers: Record<string, string> = {};
  for (const line of text.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
    else headers[name] = value;
  }
  return {status, headers};
}
