import {
  type BashOperations,
  createBashToolDefinition,
  createEditToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type EditOperations,
  getShellConfig,
  type LsOperations,
  type ReadOperations,
  type ToolDefinition,
  type WriteOperations,
} from '@earendil-works/pi-coding-agent';
import type {ExecutionHost, HostProcess, HostProcessExit} from '@shipfox/runner-container';
import {detectSupportedImageMimeType} from '#core/pi-image-mime.js';

/** What pi activates when a step does not pick tools. */
const DEFAULT_PI_TOOL_NAMES = ['read', 'bash', 'edit', 'write'] as const;
const MAX_TIMEOUT_SECONDS = 2_147_483.647;
// How long the pipes may stay quiet after the shell exited before a background process that kept
// them open is left behind. Matches pi's local bash tool.
const OUTPUT_IDLE_GRACE_MS = 100;

export interface PiHostToolSettings {
  readonly autoResizeImages: boolean;
  readonly shellCommandPrefix: string | undefined;
  readonly shellPath: string | undefined;
}

/**
 * Definitions that replace pi's built-in file and shell tools with ones backed by `host`.
 *
 * Only tools the session will expose are replaced, because a registered tool is active unless the
 * step selects tools explicitly.
 */
export function createPiHostToolDefinitions(params: {
  host: ExecutionHost;
  cwd: string;
  /** The step's tool selection, when it has one. */
  selectedTools: readonly string[] | undefined;
  settings: PiHostToolSettings;
  /** Becomes `GIT_CONFIG_GLOBAL` for shell commands only, instead of the runner's environment. */
  gitConfigGlobal: string | undefined;
}): ToolDefinition[] {
  const {host, cwd, settings} = params;
  const exposed = new Set(params.selectedTools ?? DEFAULT_PI_TOOL_NAMES);
  const definitions: Array<[string, () => ToolDefinition]> = [
    [
      'read',
      () =>
        createReadToolDefinition(cwd, {
          autoResizeImages: settings.autoResizeImages,
          operations: createReadOperations(host),
        }) as ToolDefinition,
    ],
    [
      'bash',
      () =>
        createBashToolDefinition(cwd, {
          ...(settings.shellCommandPrefix === undefined
            ? {}
            : {commandPrefix: settings.shellCommandPrefix}),
          ...(settings.shellPath === undefined ? {} : {shellPath: settings.shellPath}),
          operations: createBashOperations(host, {
            shellPath: settings.shellPath,
            gitConfigGlobal: params.gitConfigGlobal,
          }),
        }) as ToolDefinition,
    ],
    [
      'edit',
      () =>
        createEditToolDefinition(cwd, {operations: createEditOperations(host)}) as ToolDefinition,
    ],
    [
      'write',
      () =>
        createWriteToolDefinition(cwd, {operations: createWriteOperations(host)}) as ToolDefinition,
    ],
    [
      'ls',
      () => createLsToolDefinition(cwd, {operations: createLsOperations(host)}) as ToolDefinition,
    ],
  ];
  return definitions.filter(([name]) => exposed.has(name)).map(([, create]) => create());
}

function createReadOperations(host: ExecutionHost): ReadOperations {
  return {
    readFile: (path) => host.readFile(path),
    access: async (path) => {
      await host.stat(path);
    },
    detectImageMimeType: async (path) => detectSupportedImageMimeType(await host.readFile(path)),
  };
}

function createEditOperations(host: ExecutionHost): EditOperations {
  return {
    readFile: (path) => host.readFile(path),
    writeFile: (path, content) => host.writeFile(path, Buffer.from(content, 'utf-8')),
    access: async (path) => {
      await host.stat(path);
    },
  };
}

function createWriteOperations(host: ExecutionHost): WriteOperations {
  return {
    writeFile: (path, content) => host.writeFile(path, Buffer.from(content, 'utf-8')),
    mkdir: (directory) => host.mkdir(directory, {recursive: true}),
  };
}

function createLsOperations(host: ExecutionHost): LsOperations {
  return {
    exists: (path) => host.exists(path),
    stat: async (path) => {
      const stat = await host.stat(path);
      return {isDirectory: () => stat.type === 'directory'};
    },
    readdir: async (path) => (await host.readdir(path)).map((entry) => entry.name),
  };
}

export function createBashOperations(
  host: ExecutionHost,
  options: {shellPath: string | undefined; gitConfigGlobal: string | undefined},
): BashOperations {
  return {
    exec: async (command, cwd, {onData, signal, timeout, env}) => {
      const timeoutMs = timeoutMilliseconds(timeout);
      if (signal?.aborted) throw new Error('aborted');
      if (!(await host.exists(cwd))) {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
      }

      const shell = getShellConfig(options.shellPath);
      const child = host.spawn({
        argv: [shell.shell, ...shell.args, command],
        cwd,
        env: shellEnvironment(env ?? process.env, options.gitConfigGlobal),
      });
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      const guard = killOnAbortOrTimeout(child, {signal, timeoutMs});
      try {
        const {exitCode} = await waitForQuietOutput(child);
        if (signal?.aborted) throw new Error('aborted');
        if (guard.timedOut()) throw new Error(`timeout:${timeout}`);
        return {exitCode};
      } finally {
        guard.dispose();
      }
    },
  };
}

function shellEnvironment(
  env: NodeJS.ProcessEnv,
  gitConfigGlobal: string | undefined,
): Record<string, string> {
  return {
    ...definedEntries(env),
    ...(gitConfigGlobal === undefined ? {} : {GIT_CONFIG_GLOBAL: gitConfigGlobal}),
  };
}

function killOnAbortOrTimeout(
  child: HostProcess,
  params: {signal: AbortSignal | undefined; timeoutMs: number | undefined},
): {timedOut(): boolean; dispose(): void} {
  let timedOut = false;
  const kill = () => {
    child.killTree().catch(() => undefined);
  };
  const timer =
    params.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          kill();
        }, params.timeoutMs);
  if (params.signal?.aborted) kill();
  else params.signal?.addEventListener('abort', kill, {once: true});
  return {
    timedOut: () => timedOut,
    dispose: () => {
      if (timer) clearTimeout(timer);
      params.signal?.removeEventListener('abort', kill);
    },
  };
}

function timeoutMilliseconds(timeoutSeconds: number | undefined): number | undefined {
  if (timeoutSeconds === undefined) return undefined;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('Invalid timeout: must be a finite number of seconds');
  }
  if (timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return timeoutSeconds * 1000;
}

function definedEntries(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) entries[name] = value;
  }
  return entries;
}

/**
 * Resolves with the shell's exit once its output pipes ended, or went quiet for a moment after
 * the exit. A background process that inherited the pipes would otherwise hold the tool call
 * open for as long as it runs.
 */
function waitForQuietOutput(child: HostProcess): Promise<HostProcessExit> {
  return new Promise((resolve, reject) => {
    let exit: HostProcessExit | undefined;
    let stdoutEnded = false;
    let stderrEnded = false;
    let settled = false;
    let idleTimer: NodeJS.Timeout | undefined;

    const finish = () => {
      if (settled || exit === undefined) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(exit);
    };
    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, OUTPUT_IDLE_GRACE_MS);
    };
    const finishWhenDrained = () => {
      if (stdoutEnded && stderrEnded) finish();
    };
    const onData = () => {
      if (exit !== undefined && !settled) armIdleTimer();
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.stdout.once('end', () => {
      stdoutEnded = true;
      finishWhenDrained();
    });
    child.stderr.once('end', () => {
      stderrEnded = true;
      finishWhenDrained();
    });
    // `exited` rejects together with `processExited`, so one rejection handler covers both.
    child.exited.catch(() => undefined);
    child.processExited.then((processExit) => {
      exit = processExit;
      finishWhenDrained();
      if (!settled) armIdleTimer();
    }, reject);
  });
}
