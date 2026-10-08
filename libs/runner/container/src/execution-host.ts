import type {Readable, Writable} from 'node:stream';

export interface SpawnRequest {
  /** The executable and its arguments. The executable is not resolved through a shell. */
  readonly argv: readonly [executable: string, ...args: string[]];
  /** The working directory. Defaults to the runner's own. */
  readonly cwd?: string | undefined;
  /** The complete environment of the process. The host adds nothing to it. */
  readonly env: Readonly<Record<string, string>>;
  /** `ignore` by default. */
  readonly stdin?: 'pipe' | 'ignore' | undefined;
  /**
   * Kills the process tree as soon as the process exits, so background processes it left behind
   * cannot hold its output pipes open.
   */
  readonly killTreeOnExit?: boolean | undefined;
}

export interface HostProcessExit {
  readonly exitCode: number | null;
  /** The signal that ended the process, when one did. */
  readonly signal: NodeJS.Signals | null;
}

export interface HostProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin?: Writable | undefined;
  /**
   * Settles once the process ended and both output pipes closed, so every chunk was already
   * emitted. Rejects when the process could not be started.
   */
  readonly exited: Promise<HostProcessExit>;
  /**
   * Settles once the process itself ended, without waiting for its output pipes. A descendant that
   * outlives it can hold the pipes open, so callers that must not wait for it read the pipes until
   * they go quiet instead of waiting for `exited`. Rejects when the process could not be started.
   */
  readonly processExited: Promise<HostProcessExit>;
  /** SIGKILLs the process and every descendant. Does nothing once the tree is gone. */
  killTree(): Promise<void>;
}

export type HostFileType = 'file' | 'directory' | 'symlink' | 'other';

export interface HostStat {
  readonly type: HostFileType;
  readonly size: number;
  readonly mode: number;
  readonly mtimeMs: number;
}

export interface HostDirEntry {
  readonly name: string;
  readonly type: HostFileType;
}

export interface HostReadFileOptions {
  /** Reads at most this many bytes from the start of the file. */
  readonly length?: number | undefined;
}

export interface HostWriteFileOptions {
  readonly mode?: number | undefined;
  /** Fails with `EEXIST` instead of replacing an existing file. */
  readonly exclusive?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Where a job's processes run and where their files live. Paths are the same on the runner and
 * on the host, so a path the runner builds is valid for every method.
 */
export interface ExecutionHost {
  spawn(request: SpawnRequest): HostProcess;
  /** Reads the whole file, or only its first `length` bytes when given. */
  readFile(path: string, options?: HostReadFileOptions): Promise<Buffer>;
  /** Streams `data` when it is a `Readable`. */
  writeFile(
    path: string,
    data: Uint8Array | Readable,
    options?: HostWriteFileOptions,
  ): Promise<void>;
  /** Follows symlinks. Rejects with `ENOENT` when the path does not exist. */
  stat(path: string): Promise<HostStat>;
  readdir(path: string): Promise<HostDirEntry[]>;
  mkdir(path: string, options?: {recursive?: boolean}): Promise<void>;
  exists(path: string): Promise<boolean>;
}
