import {execFile} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {deleteOrg} from '@shipfox/e2e-helper-integrations-gitea';
import {stopProvisioner} from '@shipfox/e2e-helper-runners';
import {getProvisionerHandle, readSuiteContext, suiteFailed} from '#suite-context.js';

const execFileAsync = promisify(execFile);

export default async function globalTeardown(): Promise<void> {
  const handle = getProvisionerHandle();
  const failed = suiteFailed();
  if (handle) {
    if (failed) {
      await captureRunnerDiagnostics(handle.workspaceId).catch((error: unknown) => {
        process.stderr.write(
          `platform-e2e teardown: captureRunnerDiagnostics failed: ${String(error)}\n`,
        );
      });
    }
    await stopProvisioner(handle).catch((error: unknown) => {
      process.stderr.write(`platform-e2e teardown: stopProvisioner failed: ${String(error)}\n`);
    });
  }

  let org: string;
  try {
    org = readSuiteContext().org;
  } catch {
    return;
  }

  // Keep gitea state on failure for inspection; a fully green run deletes its org,
  // which cascades to its repos. Leaked orgs are harmless: names are unique and a
  // compose volume reset wipes the instance.
  if (failed) {
    process.stdout.write(`platform-e2e teardown: run had failures; keeping gitea org ${org}\n`);
    return;
  }
  await deleteOrg({org}).catch((error: unknown) => {
    process.stderr.write(`platform-e2e teardown: deleteOrg failed: ${String(error)}\n`);
  });
}

async function captureRunnerDiagnostics(workspaceId: string): Promise<void> {
  const dir = join(process.cwd(), 'test-results', 'runner-diagnostics');
  await mkdir(dir, {recursive: true});

  await writeCommandOutput(dir, 'docker-containers.jsonl', 'docker', [
    'ps',
    '-a',
    '--no-trunc',
    '--format',
    '{{json .}}',
  ]);

  const {stdout} = await execFileAsync('docker', [
    'ps',
    '-aq',
    '--filter',
    `label=shipfox.workspace_id=${workspaceId}`,
  ]);
  const ids = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  await writeFile(join(dir, 'runner-container-ids.txt'), `${ids.join('\n')}\n`);

  for (const id of ids) {
    const prefix = `runner-${id.slice(0, 12)}`;
    await writeCommandOutput(dir, `${prefix}.inspect.txt`, 'docker', [
      'inspect',
      '--format',
      [
        'id={{.Id}}',
        'name={{.Name}}',
        'image={{.Config.Image}}',
        'created={{.Created}}',
        'state={{json .State}}',
        'labels={{json .Config.Labels}}',
        'networks={{json .NetworkSettings.Networks}}',
      ].join('\n'),
      id,
    ]);
    await writeCommandOutput(dir, `${prefix}.log`, 'docker', ['logs', '--timestamps', id]);
  }
}

async function writeCommandOutput(
  dir: string,
  file: string,
  command: string,
  args: string[],
): Promise<void> {
  try {
    const {stdout, stderr} = await execFileAsync(command, args, {maxBuffer: 20 * 1024 * 1024});
    await writeFile(join(dir, file), `${stdout}${stderr}`);
  } catch (error) {
    const details =
      error instanceof Error && 'stderr' in error
        ? `${error.message}\n${String(error.stderr)}`
        : String(error);
    await writeFile(join(dir, file), details);
  }
}
