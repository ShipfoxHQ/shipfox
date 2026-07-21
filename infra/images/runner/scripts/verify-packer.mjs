import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const runnerWorkspace = mkdtempSync(join(tmpdir(), 'shipfox-runner-workspace-'));

try {
  runPacker(['init', '.']);
  runPacker(['fmt', '-check', '.']);
  runPacker([
    'validate',
    '-var',
    'build_attempt=1',
    '-var',
    'build_number=ci',
    '-var',
    `node_version=${process.versions.node}`,
    '-var',
    'platform=aws',
    '-var',
    'revision=ci',
    '-var',
    `runner_workspace=${runnerWorkspace}`,
    '-var',
    'runner_version=0.0.0-ci',
    '.',
  ]);
} finally {
  rmSync(runnerWorkspace, {force: true, recursive: true});
}

function runPacker(args) {
  const result = spawnSync('packer', args, {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
