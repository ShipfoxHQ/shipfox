import {randomUUID} from 'node:crypto';
import {chmodSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {
  ExecutionHost,
  HostDirEntry,
  HostFileType,
  HostProcess,
  HostReadFileOptions,
  HostStat,
  HostWriteFileOptions,
  SpawnRequest,
} from '#execution-host.js';
import {localExecutionHost} from '#local-execution-host.js';
import {runCommand} from '#run-command.js';

const ENV_FILE_MODE = 0o644;
const FALLBACK_SHELL = '/bin/sh';
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const SHELL_PATH = /^\/\S+$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

// The step environment arrives as an `export` file, so values never show up in process arguments
// and a value such as DOCKER_HOST cannot reach the runner's own `docker` calls. The file is
// deleted before the command starts. `exec` keeps the shell's PID, and `docker exec` makes that
// process a session and process group leader, so the recorded PID is the group to kill.
const EXEC_PREAMBLE = 'echo $$ > "$1.pid"; . "$1"; rm -f "$1"; shift; exec "$@"';

// While the process may not have started yet, waits for the preamble to record the PID.
const KILL_SCRIPT = `
i=0
while [ -n "$2" ] && [ ! -s "$1" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i+1)); done
[ -s "$1" ] || exit 1
read -r pid < "$1"
rm -f "$1"
kill -KILL "-$pid"
`;

const READDIR_SCRIPT = `
[ -e "$1" ] || { echo 'No such file or directory' >&2; exit 1; }
[ -d "$1" ] || { echo 'Not a directory' >&2; exit 1; }
cd -- "$1" || exit 1
for f in * .[!.]* ..?*; do
  if [ -L "$f" ]; then t=l; elif [ -d "$f" ]; then t=d; elif [ -f "$f" ]; then t=f; elif [ -e "$f" ]; then t=o; else continue; fi
  printf '%s%s\\0' "$t" "$f"
done
`;

const WRITE_SCRIPT = `
[ -z "$2" ] || umask "$2"
[ -z "$3" ] || set -C
cat > "$1" || exit 1
[ -z "$4" ] || chmod "$4" "$1"
`;

// The shell runs script steps: `bash` when the image has it, else `sh`.
const IMAGE_PROBE_SCRIPT = `command -v bash || echo ${FALLBACK_SHELL}
echo "$PATH"`;

const MKDIR_SCRIPT =
  'if [ "$2" = recursive ]; then exec mkdir -p -- "$1"; else exec mkdir -- "$1"; fi';

const FILE_ERROR_CODES: ReadonlyArray<readonly [message: RegExp, code: string]> = [
  [/no such file or directory|directory nonexistent|nonexistent directory/iu, 'ENOENT'],
  [/not a directory/iu, 'ENOTDIR'],
  [/file exists/iu, 'EEXIST'],
  [/is a directory/iu, 'EISDIR'],
  [/permission denied/iu, 'EACCES'],
];

export interface ContainerExecutionHostParams {
  /** The running job container. */
  container: string;
  /**
   * The job's scratch directory. The container sees it at the same path, so the environment files
   * the runner writes there are readable inside.
   */
  tempDir: string;
}

export interface ContainerImageProbe {
  /** The shell that runs script steps. */
  readonly shell: string;
  /** The `PATH` a process in the container starts with. */
  readonly path: string;
}

/** An error from a file operation in the container, with the `code` Node's `fs` would give. */
export class ContainerFileError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'ContainerFileError';
  }
}

/**
 * Runs processes in the job container with `docker exec` and reads and writes files through
 * `cat` and friends, so files the runner creates belong to the container user.
 *
 * The container starts from the image's own environment. A process gets the environment of the
 * request on top of it, never the runner's.
 */
export class ContainerExecutionHost implements ExecutionHost {
  private readonly container: string;
  private readonly tempDir: string;
  private image: Promise<ContainerImageProbe> | undefined;

  constructor(params: ContainerExecutionHostParams) {
    this.container = params.container;
    this.tempDir = params.tempDir;
  }

  /** What the image gives a step: its shell and its `PATH`. Probed once. */
  probe(): Promise<ContainerImageProbe> {
    this.image ??= this.probeImage();
    return this.image;
  }

  spawn(request: SpawnRequest): HostProcess {
    const envFile = join(this.tempDir, `shipfox-exec-${randomUUID()}.env`);
    const pidFile = `${envFile}.pid`;
    // The container user may not be the runner user, and it must read and delete this file.
    writeFileSync(envFile, exportLines(request.env), {mode: ENV_FILE_MODE});
    chmodSync(envFile, ENV_FILE_MODE);

    const child = localExecutionHost.spawn({
      argv: [
        'docker',
        'exec',
        ...(request.stdin === 'pipe' ? ['-i'] : []),
        ...(request.cwd === undefined ? [] : ['--workdir', request.cwd]),
        this.container,
        '/bin/sh',
        '-c',
        EXEC_PREAMBLE,
        'sh',
        envFile,
        ...request.argv,
      ],
      env: runnerEnv(),
      stdin: request.stdin,
    });

    let finished = false;
    let killing: Promise<void> | undefined;
    const killGroup = async (): Promise<boolean> => {
      const result = await runCommand({
        argv: [
          'docker',
          'exec',
          this.container,
          'sh',
          '-c',
          KILL_SCRIPT,
          'sh',
          pidFile,
          finished ? '' : 'wait',
        ],
      }).catch(() => undefined);
      return result?.exitCode === 0;
    };
    const exited = child.exited.then(async (exit) => {
      // The kill comes first so the step does not settle while a background process runs on.
      finished = true;
      if (request.killTreeOnExit) await killGroup();
      return exit;
    });
    // A failed start rejects `exited` for the caller, so it must not also be unhandled here.
    exited.catch(() => undefined);

    return {
      stdout: child.stdout,
      stderr: child.stderr,
      ...(child.stdin ? {stdin: child.stdin} : {}),
      exited,
      processExited: child.processExited,
      killTree: () => {
        // Killing the local client alone would leave the process running in the container. The
        // group can outlive the client, so a finished client does not mean a finished tree.
        killing ??= (async () => {
          if (!(await killGroup())) await child.killTree();
        })();
        return killing;
      },
    };
  }

  async readFile(path: string, options: HostReadFileOptions = {}): Promise<Buffer> {
    const head = options.length;
    const result =
      head === undefined
        ? await this.run({script: 'exec cat -- "$1"', args: [path], path})
        : await this.run({script: 'exec head -c "$2" -- "$1"', args: [path, String(head)], path});
    return result.stdout;
  }

  async writeFile(
    path: string,
    data: Uint8Array | Readable,
    options: HostWriteFileOptions = {},
  ): Promise<void> {
    const mode = options.mode;
    await this.run({
      script: WRITE_SCRIPT,
      args: [
        path,
        mode === undefined ? '' : (0o777 & ~mode).toString(8),
        options.exclusive ? 'exclusive' : '',
        mode === undefined ? '' : mode.toString(8),
      ],
      path,
      stdin: data,
      signal: options.signal,
    });
  }

  async stat(path: string): Promise<HostStat> {
    const {stdout} = await this.run({
      script: 'exec stat -L -c \'%f %s %Y\' -- "$1"',
      args: [path],
      path,
    });
    const [rawMode = '', rawSize = '', rawMtime = ''] = stdout.toString('utf8').trim().split(' ');
    const mode = Number.parseInt(rawMode, 16);
    const size = Number(rawSize);
    const mtime = Number(rawMtime);
    if (Number.isNaN(mode) || Number.isNaN(size) || Number.isNaN(mtime)) {
      throw new ContainerFileError(
        `Could not read the status of ${path} in the container.`,
        undefined,
      );
    }
    return {type: statType(mode), size, mode, mtimeMs: mtime * 1000};
  }

  async readdir(path: string): Promise<HostDirEntry[]> {
    const {stdout} = await this.run({script: READDIR_SCRIPT, args: [path], path});
    return stdout
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry.length > 0)
      .map((entry) => ({name: entry.slice(1), type: direntType(entry[0])}));
  }

  async mkdir(path: string, options: {recursive?: boolean} = {}): Promise<void> {
    await this.run({
      script: MKDIR_SCRIPT,
      args: [path, options.recursive ? 'recursive' : ''],
      path,
    });
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.exec({script: 'exec test -e "$1"', args: [path]});
    return result.exitCode === 0;
  }

  private async probeImage(): Promise<ContainerImageProbe> {
    const result = await this.exec({script: IMAGE_PROBE_SCRIPT, args: []});
    const [shell = '', path = ''] = result.stdout.toString('utf8').split('\n');
    return {
      shell: result.exitCode === 0 && SHELL_PATH.test(shell) ? shell : FALLBACK_SHELL,
      path: result.exitCode === 0 ? path : '',
    };
  }

  // Runs `sh -c <script> sh <args>` in the container and rejects when it exits non-zero.
  private async run(params: {
    script: string;
    args: readonly string[];
    path: string;
    stdin?: Uint8Array | Readable | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<ExecResult> {
    const result = await this.exec(params);
    if (result.exitCode === 0) return result;
    const detail = result.stderr.trim();
    throw new ContainerFileError(
      detail || `The file operation on ${params.path} failed in the container.`,
      FILE_ERROR_CODES.find(([message]) => message.test(detail))?.[1],
    );
  }

  private async exec(params: {
    script: string;
    args: readonly string[];
    stdin?: Uint8Array | Readable | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<ExecResult> {
    const child = localExecutionHost.spawn({
      argv: [
        'docker',
        'exec',
        ...(params.stdin === undefined ? [] : ['-i']),
        this.container,
        'sh',
        '-c',
        params.script,
        'sh',
        ...params.args,
      ],
      env: runnerEnv(),
      stdin: params.stdin === undefined ? 'ignore' : 'pipe',
    });
    const stdout = collect(child.stdout);
    const stderr = collect(child.stderr);
    const abort = () => void child.killTree();
    params.signal?.addEventListener('abort', abort, {once: true});
    if (params.signal?.aborted) abort();
    const feed = feedStdin(child, params.stdin);
    try {
      const [{exitCode}] = await Promise.all([child.exited, feed]);
      params.signal?.throwIfAborted();
      return {
        exitCode,
        stdout: Buffer.concat(await stdout),
        stderr: Buffer.concat(await stderr).toString('utf8'),
      };
    } catch (error) {
      if (params.signal?.aborted) throw params.signal.reason ?? error;
      throw error;
    } finally {
      params.signal?.removeEventListener('abort', abort);
    }
  }
}

interface ExecResult {
  readonly exitCode: number | null;
  readonly stdout: Buffer;
  readonly stderr: string;
}

async function feedStdin(child: HostProcess, data: Uint8Array | Readable | undefined) {
  const stdin = child.stdin;
  if (stdin === undefined || data === undefined) return;
  // The command can exit before it reads everything, which closes the pipe under the writer.
  stdin.on('error', () => undefined);
  if (data instanceof Readable) {
    await new Promise<void>((resolve) => {
      data.on('error', () => {
        stdin.destroy();
        resolve();
      });
      stdin.on('close', resolve);
      data.pipe(stdin);
    });
    return;
  }
  stdin.end(data);
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return chunks;
}

function exportLines(env: Readonly<Record<string, string>>): string {
  // A name that is not a shell identifier cannot be exported, and sourcing it would abort the step.
  return Object.entries(env)
    .filter(([name]) => ENV_NAME.test(name))
    .map(([name, value]) => `export ${name}=${shellQuote(value)}\n`)
    .join('');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// The `docker` client runs with the runner's own environment: it needs PATH, DOCKER_HOST, and the
// Docker config. Nothing the step sets reaches it.
function runnerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined) env[name] = value;
  return env;
}

function statType(mode: number): HostFileType {
  const type = mode & S_IFMT;
  if (type === S_IFREG) return 'file';
  if (type === S_IFDIR) return 'directory';
  return 'other';
}

function direntType(code: string | undefined): HostFileType {
  if (code === 'f') return 'file';
  if (code === 'd') return 'directory';
  if (code === 'l') return 'symlink';
  return 'other';
}
