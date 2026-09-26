import {execFileSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SHELL_WORD_SEPARATOR = /[\s\\]+/u;

export interface ShellFixture {
  root: string;
  commandDirectory: string;
  commandLog: string;
  environment: NodeJS.ProcessEnv;
}

// Scripts run with only the fixture's command directory on PATH, so every command they call is
// either a logged fake or an explicitly linked host tool.
export async function createShellFixture(hostCommands: string[] = []): Promise<ShellFixture> {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-runner-base-'));
  const commandDirectory = join(root, 'commands');
  const commandLog = join(root, 'command.log');
  await mkdir(commandDirectory, {recursive: true});
  await writeFile(commandLog, '');
  for (const command of hostCommands) {
    const hostPath = execFileSync('/bin/sh', ['-c', `command -v ${command}`], {encoding: 'utf8'});
    await symlink(hostPath.trim(), join(commandDirectory, command));
  }
  return {
    root,
    commandDirectory,
    commandLog,
    environment: {
      ...process.env,
      PATH: commandDirectory,
      RUNNER_BASE_COMMAND_LOG: commandLog,
      RUNNER_BASE_ROOT: root,
    },
  };
}

export async function writeLoggedCommand(
  fixture: ShellFixture,
  command: string,
  body = '',
): Promise<void> {
  await writeExecutable(
    join(fixture.commandDirectory, command),
    `#!/bin/sh\nset -eu\nprintf '${command} %s\\n' "$*" >> "$RUNNER_BASE_COMMAND_LOG"\n${body}`,
  );
}

export async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readCommandLog(fixture: ShellFixture): Promise<string[]> {
  return (await readFile(fixture.commandLog, 'utf8')).trim().split('\n').filter(Boolean);
}

// Reads the package words a script lists between its first and last package names.
export async function readScriptPackages(
  path: string,
  firstPackage: string,
  lastPackage: string,
): Promise<string[]> {
  const source = await readFile(path, 'utf8');
  const start = source.indexOf(firstPackage);
  const end = source.indexOf(lastPackage, start) + lastPackage.length;
  return source.slice(start, end).split(SHELL_WORD_SEPARATOR).filter(Boolean);
}
