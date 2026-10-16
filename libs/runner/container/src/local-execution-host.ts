import {type ChildProcess, spawn} from 'node:child_process';
import {createWriteStream, type Dirent, type Stats} from 'node:fs';
import {access, mkdir, open, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {
  DEFAULT_TERMINATE_GRACE_MS,
  type ExecutionHost,
  type HostDirEntry,
  type HostFileType,
  type HostProcess,
  type HostProcessExit,
  type HostReadFileOptions,
  type HostStat,
  type HostWriteFileOptions,
  type KillTreeMode,
  type SpawnRequest,
} from '#execution-host.js';

const GROUP_POLL_MS = 50;

export interface LocalExecutionHostParams {
  /** How long `killTree('terminate')` waits after SIGTERM before it SIGKILLs. 10 s by default. */
  terminateGraceMs?: number | undefined;
}

/** Runs processes on the runner's machine and reads and writes its files with Node `fs`. */
export class LocalExecutionHost implements ExecutionHost {
  private readonly terminateGraceMs: number;

  constructor(params: LocalExecutionHostParams = {}) {
    this.terminateGraceMs = params.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
  }

  spawn(request: SpawnRequest): HostProcess {
    const command = withDefaultOomScore(request.argv);
    // detached:true makes the process a process-group leader, so killTree() can SIGKILL its
    // grandchildren too (Linux does not propagate signals down the parent chain). We don't
    // unref(): output capture still needs `close`.
    const child = spawn(command.executable, command.args, {
      stdio: [request.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: request.cwd,
      env: {...request.env},
    });
    let terminating: Promise<void> | undefined;
    const killTree = (mode: KillTreeMode = 'kill'): Promise<void> => {
      if (mode === 'kill') {
        signalProcessGroup(child, 'SIGKILL');
        return Promise.resolve();
      }
      terminating ??= terminateProcessGroup(child, this.terminateGraceMs);
      return terminating;
    };
    if (!child.stdout || !child.stderr) {
      signalProcessGroup(child, 'SIGKILL');
      throw new Error('Failed to spawn process without output pipes');
    }
    if (request.killTreeOnExit) child.on('exit', () => signalProcessGroup(child, 'SIGKILL'));

    const exited = new Promise<HostProcessExit>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (exitCode, signal) => resolve({exitCode, signal}));
    });
    const processExited = new Promise<HostProcessExit>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (exitCode, signal) => resolve({exitCode, signal}));
    });
    // Most callers wait for `exited` only, and a failed start must not also be an unhandled rejection.
    processExited.catch(() => undefined);
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      ...(child.stdin ? {stdin: child.stdin} : {}),
      exited,
      processExited,
      killTree,
    };
  }

  async readFile(path: string, options: HostReadFileOptions = {}): Promise<Buffer> {
    if (options.length === undefined) return await readFile(path);
    const file = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(options.length);
      let bytesRead = 0;
      // A read can return fewer bytes than asked before the end of the file.
      while (bytesRead < options.length) {
        const result = await file.read(buffer, bytesRead, options.length - bytesRead, bytesRead);
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  }

  async writeFile(
    path: string,
    data: Uint8Array | Readable,
    options: HostWriteFileOptions = {},
  ): Promise<void> {
    const flag = options.exclusive ? 'wx' : 'w';
    if (data instanceof Readable) {
      await pipeline(
        data,
        createWriteStream(path, {
          flags: flag,
          ...(options.mode === undefined ? {} : {mode: options.mode}),
        }),
        options.signal === undefined ? {} : {signal: options.signal},
      );
      return;
    }
    await writeFile(path, data, {
      flag,
      ...(options.mode === undefined ? {} : {mode: options.mode}),
      ...(options.signal === undefined ? {} : {signal: options.signal}),
    });
  }

  async stat(path: string): Promise<HostStat> {
    const stats = await stat(path);
    return {
      type: statsType(stats),
      size: stats.size,
      mode: stats.mode,
      mtimeMs: stats.mtimeMs,
    };
  }

  async readdir(path: string): Promise<HostDirEntry[]> {
    const entries = await readdir(path, {withFileTypes: true});
    return entries.map((entry) => ({name: entry.name, type: direntType(entry)}));
  }

  async mkdir(path: string, options: {recursive?: boolean} = {}): Promise<void> {
    await mkdir(path, {recursive: options.recursive ?? false});
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}

export const localExecutionHost: ExecutionHost = new LocalExecutionHost();

// Returns false when the group is already gone. Signal 0 only probes the group.
function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals | 0): boolean {
  if (child.pid === undefined) return false;
  try {
    // Negative pid signals the entire process group.
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

// A descendant can outlive the process itself, so the group, not the process, is what must end.
async function terminateProcessGroup(child: ChildProcess, graceMs: number): Promise<void> {
  if (!signalProcessGroup(child, 'SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(GROUP_POLL_MS, deadline - Date.now()));
    if (!signalProcessGroup(child, 0)) return;
  }
  signalProcessGroup(child, 'SIGKILL');
}

// Runner images lower the runner's OOM score, and children inherit it. The process resets its
// own score before it execs, so the kernel kills a runaway step before the runner or the host's
// daemons. Resetting from the runner after spawn would race the process's first fork.
function withDefaultOomScore(argv: SpawnRequest['argv']): {executable: string; args: string[]} {
  const [executable, ...args] = argv;
  if (process.platform !== 'linux') return {executable, args};
  return {
    executable: '/bin/sh',
    args: [
      '-c',
      '{ echo 0 > /proc/self/oom_score_adj; } 2>/dev/null; exec "$@"',
      'sh',
      executable,
      ...args,
    ],
  };
}

// `stat` follows symlinks, so a symlink never shows up here. Only `readdir` reports one.
function statsType(stats: Stats): HostFileType {
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

function direntType(entry: Dirent): HostFileType {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  if (entry.isSymbolicLink()) return 'symlink';
  return 'other';
}
