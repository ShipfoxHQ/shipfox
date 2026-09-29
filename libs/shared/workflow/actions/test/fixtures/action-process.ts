import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ActionContextFileV1, ActionOutputDeclarations, ActionResultFileV1} from '#contract.js';
import {ACTION_BOOTSTRAP_PATH, ACTION_LOADER_PATH} from '#runtime-files.js';

export const sdkEntryPath = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

export const ACTION_TOKEN = 'step-token';

/**
 * A job layout on disk: the step working directory where earlier steps installed packages, and
 * the extracted action bundle outside it, as the runner lays them out.
 */
export interface ActionSandbox {
  readonly root: string;
  readonly workspace: string;
  readonly bundle: string;
  readonly stepTemp: string;
  cleanup(): Promise<void>;
}

export async function createActionSandbox(): Promise<ActionSandbox> {
  if (!existsSync(ACTION_BOOTSTRAP_PATH)) {
    throw new Error(
      `${ACTION_BOOTSTRAP_PATH} is missing. Build @shipfox/actions before these tests.`,
    );
  }
  // Node reports real paths (macOS tmpdir is a symlink), so the sandbox uses them too.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-action-')));
  const sandbox = {
    root,
    workspace: join(root, 'workspace'),
    bundle: join(root, 'job', 'actions', 'sha256-test'),
    stepTemp: join(root, 'job', 'step'),
    cleanup: () => rm(root, {recursive: true, force: true}),
  };
  await Promise.all([
    mkdir(sandbox.workspace, {recursive: true}),
    mkdir(sandbox.stepTemp, {recursive: true}),
    writeFiles(sandbox.bundle, {'package.json': JSON.stringify({type: 'module'})}),
  ]);
  return sandbox;
}

export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, content);
  }
}

/** Writes a package with a `package.json` and an ESM `index.js`. */
export function writePackage(
  dir: string,
  params: {name: string; index: string; dependencies?: Record<string, string>},
): Promise<void> {
  return writeFiles(dir, {
    'package.json': JSON.stringify({
      name: params.name,
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
      ...(params.dependencies ? {dependencies: params.dependencies} : {}),
    }),
    'index.js': params.index,
  });
}

/** Creates a relative directory symlink, as npm, pnpm, and workspaces do. */
export async function linkDirectory(target: string, path: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await symlink(relative(dirname(path), target), path, 'dir');
}

export interface RunActionProcessParams {
  sandbox: ActionSandbox;
  main?: string;
  /** The step config origin. Omitted means the runner did not set it. */
  origin?: 'local' | 'registry' | undefined;
  inputs?: Record<string, unknown>;
  outputs?: ActionOutputDeclarations;
  actionsUrl?: string;
  /** Called with each stdout chunk, with the child to signal. */
  onStdout?: (chunk: string, child: {kill(signal: NodeJS.Signals): boolean}) => void;
}

export interface ActionProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  result: ActionResultFileV1 | null;
  outputs: Record<string, string>;
}

export async function runActionProcess(
  params: RunActionProcessParams,
): Promise<ActionProcessResult> {
  const {sandbox} = params;
  const paths = {
    inputs: join(sandbox.stepTemp, 'inputs.json'),
    context: join(sandbox.stepTemp, 'context.json'),
    result: join(sandbox.stepTemp, 'result.json'),
    output: join(sandbox.stepTemp, 'output'),
  };
  const context: ActionContextFileV1 = {
    context: {
      runId: 'run-1',
      jobId: 'job-1',
      jobKey: 'build',
      stepId: 'step-1',
      stepKey: 'act',
      actionPath: './.shipfox/actions/test',
      digest: 'sha256:test',
      workspace: sandbox.workspace,
    },
    outputs: params.outputs ?? {},
  };
  await Promise.all([
    writeFile(paths.inputs, JSON.stringify(params.inputs ?? {}), {mode: 0o600}),
    writeFile(paths.context, JSON.stringify(context)),
    writeFile(paths.output, ''),
    rm(paths.result, {force: true}),
  ]);

  const child = spawn(
    process.execPath,
    [
      '--import',
      ACTION_LOADER_PATH,
      '--disable-warning=ExperimentalWarning',
      ACTION_BOOTSTRAP_PATH,
    ],
    {
      cwd: sandbox.workspace,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SHIPFOX_WORKSPACE: sandbox.workspace,
        SHIPFOX_OUTPUT: paths.output,
        SHIPFOX_ACTION_PATH: sandbox.bundle,
        SHIPFOX_ACTION_MAIN: params.main ?? 'index.js',
        ...(params.origin ? {SHIPFOX_ACTION_ORIGIN: params.origin} : {}),
        SHIPFOX_ACTION_INPUTS: paths.inputs,
        SHIPFOX_ACTION_CONTEXT: paths.context,
        SHIPFOX_ACTION_RESULT: paths.result,
        SHIPFOX_ACTIONS_URL: params.actionsUrl ?? 'http://127.0.0.1:9',
        SHIPFOX_ACTIONS_TOKEN: ACTION_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
    params.onStdout?.(chunk, child);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });

  return {
    exitCode,
    stdout,
    stderr,
    result: existsSync(paths.result)
      ? (JSON.parse(await readFile(paths.result, 'utf8')) as ActionResultFileV1)
      : null,
    outputs: parseOutputFile(await readFile(paths.output, 'utf8')),
  };
}

const HEREDOC_START_RE = /^([^=<]+)<<(.+)$/;

function parseOutputFile(content: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const heredoc = HEREDOC_START_RE.exec(line);
    if (heredoc?.[1] && heredoc[2]) {
      const end = lines.indexOf(heredoc[2], index + 1);
      if (end < 0) break;
      outputs[heredoc[1]] = lines.slice(index + 1, end).join('\n');
      index = end;
      continue;
    }
    const separator = line.indexOf('=');
    if (separator > 0) outputs[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return outputs;
}
